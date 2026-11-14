"""Preview 0.34 (the bed panel build, stages a and b) in a real browser: "Saved" under the heading of the right-hand panel,
Undo putting a record back where it stood, the To settle fix for bed lengths as a way into Edit layout that changes nothing
itself, and personal use or commercial as a flag on a planting, a bed and a garden, with what it does to worth, to the Harvest
page and to the list that is sent. Every figure on the page is checked against the forecast's own.
usage: python3 -I bedpanel_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, $ = id => document.getElementById(id), eng = S.engine, txt = id => ($(id) || {}).textContent || '';"
       "const worth = (use) => F.build(eng, use ? { use } : {}).rows.reduce((n, r) => n + r.worth, 0);"
       "const line = host => { const el = document.querySelector(host + ' .insp-saved'); return el ? { state: el.dataset.state, text: el.textContent, undo: !!el.querySelector('[data-saved=undo]'), after: (el.previousElementSibling || {}).tagName, clipped: el.scrollWidth > el.clientWidth + 1 } : null; };"
       "const priced = p => { const r = eng.calc(p), y = r && eng.yieldOf(p, r); return !!(r && y && y.set && y.units > 0 && y.price > 0 && r.harvestDays > 0 && eng.isSoilBed(r.b)); };"
       "const dollarsOf = ids => { let n = 0; for (const r of F.build(E.create({ ...S.plan, plantings: S.plan.plantings.map(p => { const q = { ...p }; delete q.use; return q; }), beds: S.plan.beds.map(b => { const q = { ...b }; delete q.use; return q; }), gardens: S.plan.gardens.map(g => { const q = { ...g }; delete q.use; return q; }) }, LRFLibrary)).rows) for (const x of r.plantings) if (ids.includes(x.p.id)) n += x.inYear * x.price; return n; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark" if DARK else "light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
    page.evaluate("LRFApp.state.undo.length = 0")   # loading a backup is a step of its own: the checks below count from here
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0
    def click(sel, ms=350):   # a thing a fault has removed is not clicked: the named line after it fails, and the check goes on
        if not has(sel): wait(100); return False
        page.locator(sel).first.click(); wait(ms); return True
    def fill(sel, value, then="Tab", ms=350):
        if not has(sel): wait(100); return False
        page.fill(sel, str(value)); page.keyboard.press(then); wait(ms); return True
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    key0 = js("return A.contentKey()")
    order0 = js("return { p: S.plan.plantings.map(p => p.id).join(','), b: S.plan.beds.map(b => b.id).join(','), g: S.plan.gardens.map(g => g.id).join(',') }")
    start = js("return { n: S.plan.plantings.length, undo: S.undo.length, marked: F.build(eng).personal, label: txt('buildNote') }")
    check("a plan is open, nothing is marked for personal use and there is nothing to undo; the build says 0.39", start["n"] > 300 and start["undo"] == 0 and start["marked"] == 0 and "0.39" in start["label"], start)

    # ── subjects ──
    sub = js("""const inBed = new Map(); for (const p of S.plan.plantings) if (priced(p)) (inBed.get(p.bedId) || inBed.set(p.bedId, []).get(p.bedId)).push(p);
      const found = [...inBed].find(([id, list]) => list.length >= 2 && [...inBed].some(([other, more]) => other !== id && eng.bedOf(other).gardenId === eng.bedOf(id).gardenId && more.length));
      if (!found) return null;
      const [bedId, list] = found, bed = eng.bedOf(bedId), other = [...inBed].find(([o]) => o !== bedId && eng.bedOf(o).gardenId === bed.gardenId);
      return { bedId, gardenId: bed.gardenId, garden: eng.gardenOf(bed).name, one: list[0].id, two: list[1].id, otherBed: other[0], otherPlanting: other[1][0].id, cropId: list[0].cropId, bedIds: S.plan.plantings.filter(p => p.bedId === bedId).map(p => p.id),
        gardenIds: S.plan.plantings.filter(p => { const b = eng.bedOf(p.bedId); return b && b.gardenId === bed.gardenId; }).map(p => p.id), oneDollars: dollarsOf([list[0].id]) };""")
    check("a subject is found: a bed with two plantings that are worth something, in a garden with another such bed", bool(sub), sub)
    if not sub: finish()
    pick = lambda pid: (page.evaluate("id => { const e = LRFApp.state.engine, p = e.planting(id); LRFApp.setDate(e.calc(p).field); LRFApp.select({ type: 'planting', id }); }", pid), wait(250))
    pick_bed = lambda bid: (page.evaluate("id => LRFApp.select({ type: 'bed', id })", bid), wait(250))

    # ══ "Saved" in the panel ══
    page.evaluate("LRFApp.select(null)"); wait(200)
    check("the plan's overview has no such line: it is the word of a panel whose fields change the plan", js("return line('#inspectorBody')") is None)
    pick(sub["one"])
    idle = js("return line('#inspectorBody')")
    check("a planting's panel says, under its heading, that changes apply as they are made", bool(idle) and idle["state"] == "idle" and "apply as you make them" in idle["text"] and idle["after"] == "HEADER" and not idle["clipped"], idle)
    pick_bed(sub["bedId"])
    idle_bed = js("return line('#inspectorBody')")
    check("and so does a bed's", bool(idle_bed) and idle_bed["state"] == "idle" and idle_bed["after"] == "HEADER", idle_bed)
    pick(sub["one"])
    was_dtm = js(f"const v = eng.planting({json.dumps(sub['one'])}).hw; return v == null ? null : v")   # fewer harvest days can lay no planting on another: the guard rails have nothing to refuse
    fill("#fHw", 3)
    saved = js(f"return {{ dtm: eng.planting({json.dumps(sub['one'])}).hw, line: line('#inspectorBody'), last: A.lastChange(), undo: S.undo.length, clock: new Date(A.lastChange() ? A.lastChange().at : 0).toLocaleTimeString('en-US', {{ hour: 'numeric', minute: '2-digit' }}) }}")
    check("a field changed and left: the change is taken at once, with nothing to press", saved["dtm"] == 3 and saved["undo"] == 1, saved)
    check("and the panel says so in that line: Saved, what changed, the time, and its Undo", bool(saved["line"]) and saved["line"]["state"] == "saved" and saved["line"]["text"].startswith("Saved") and "Change harvest days" in saved["line"]["text"] and saved["clock"] in saved["line"]["text"] and saved["line"]["undo"] and not saved["line"]["clipped"], saved)
    shot("saved")
    click("#inspectorBody .insp-saved [data-saved=undo]")
    undone = js(f"const v = eng.planting({json.dumps(sub['one'])}).hw; return {{ dtm: v == null ? null : v, line: line('#inspectorBody'), key: A.contentKey(), undo: S.undo.length }}")
    check("the Undo in that line takes the change back, and the line goes quiet", undone["dtm"] == was_dtm and undone["key"] == key0 and undone["undo"] == 0 and bool(undone["line"]) and undone["line"]["state"] == "idle", undone)
    # it fades
    fill("#fHw", 4); wait(8600)
    faded = js("return { line: line('#inspectorBody'), last: A.lastChange() }")
    check("after a few seconds the line goes back to its quiet words by itself: nothing to dismiss", bool(faded["line"]) and faded["line"]["state"] == "idle" and faded["last"] and faded["last"]["kind"] == "saved", faded)
    page.evaluate("LRFApp.undo()"); wait(200)
    # a change that is refused says so in the same place
    no = js("""for (const b of S.plan.beds) { if (!eng.isSoilBed(b)) continue; const list = eng.plantingsIn(b.id).filter(p => eng.calc(p)); if (list.length < 2) continue;
        for (const p of list) for (const q of list) { if (p === q || p.date === q.date) continue; const e2 = E.create({ ...S.plan, plantings: S.plan.plantings.map(x => x.id === p.id ? { ...x, date: q.date } : x) }, LRFLibrary); if (LRFRails.refusal(eng, e2, [p.id])) return { id: p.id, date: q.date, was: p.date }; } }
      return null;""")
    check("a change the guard rails would refuse is found, to try", bool(no), no)
    if no:
        pick(no["id"]); fill("#fDate", no["date"])
        refused = js(f"return {{ date: eng.planting({json.dumps(no['id'])}).date, line: line('#inspectorBody'), key: A.contentKey(), field: ($('fDate') || {{}}).value, undo: S.undo.length }}")
        check("a change that is refused changes nothing, and the same line says Not changed, and why", refused["date"] == no["was"] and refused["key"] == key0 and refused["undo"] == 0 and bool(refused["line"]) and refused["line"]["state"] == "refused" and refused["line"]["text"].startswith("Not changed") and len(refused["line"]["text"]) > 30 and not refused["line"]["undo"] and refused["field"] == no["was"], refused)
        shot("refused")
    # a field left by clicking somewhere else: the value is kept, and the change is still said
    pick(sub["one"])
    spot = js("""const box = $('map').getBoundingClientRect();
      for (let fy = 0.94; fy > 0.5; fy -= 0.04) for (let fx = 0.03; fx < 0.6; fx += 0.03) { const x = Math.round(box.left + box.width * fx), y = Math.round(box.top + box.height * fy), el = document.elementFromPoint(x, y);
        if (el && $('map').contains(el) && !el.closest('#mapBeds [data-bed], .map-tools, [data-garden], text')) return { x, y }; }
      return null;""")
    check("there is open ground on the map to click", bool(spot), spot)
    if spot and has("#fHw"):
        page.fill("#fHw", "5"); page.mouse.click(spot["x"], spot["y"]); wait(400)
        away = js(f"return {{ dtm: eng.planting({json.dumps(sub['one'])}).hw, sel: S.sel, line: line('#inspectorBody'), toast: txt('toast'), shown: $('toast').classList.contains('show') }}")
        said = (away["line"] and away["line"]["state"] == "saved") if away["sel"] else (away["shown"] and away["toast"].startswith("Saved · Change harvest days") and "Undo" in away["toast"])
        check("a field left by clicking the map keeps what was typed", away["dtm"] == 5, away)
        check("and it is still said: in the panel while it is open, and once in a toast when that click closed the panel", bool(said), away)
        page.evaluate("LRFApp.undo()"); wait(200)
    # the word belongs to the panel the change was made in
    pick(sub["one"]); fill("#fHw", 6); wait(1700); pick_bed(sub["otherBed"])
    elsewhere = js("return { line: line('#inspectorBody'), toast: $('toast').classList.contains('show') ? txt('toast') : '' }")
    check("a change made in one panel is not said again in the next one opened", bool(elsewhere["line"]) and elsewhere["line"]["state"] == "idle" and not elsewhere["toast"].startswith("Saved"), elsewhere)
    page.evaluate("LRFApp.undo()"); wait(200)
    check("after all of that the plan is as it was", js("return A.contentKey()") == key0)

    # ══ Undo puts a record back where it stood ══
    mid = js("const list = S.plan.plantings; return [list[Math.floor(list.length / 2)].id, list[3].id, list[list.length - 2].id]")
    page.evaluate("ids => LRFApp.removePlantings([ids[0]])", mid); wait(250)
    if has("dialog[open] .btn.danger"): click("dialog[open] .btn.danger")
    elif has("dialog[open] .btn.primary"): click("dialog[open] .btn.primary")
    gone = js("return S.plan.plantings.length")
    page.evaluate("LRFApp.undo()"); wait(250)
    back = js("return { p: S.plan.plantings.map(p => p.id).join(','), key: A.contentKey() }")
    check("a planting removed from the middle of the plan and put back by Undo stands where it stood: the plan reads the same, and counts as the same", gone == start["n"] - 1 and back["p"] == order0["p"] and back["key"] == key0, {"gone": gone, "same": back["p"] == order0["p"], "key": back["key"] == key0})
    several = js("""const ids = %s, before = ids.map(id => eng.planting(id)), bed = S.plan.beds.find(b => !eng.plantingsIn(b.id).length && S.plan.beds.indexOf(b) < S.plan.beds.length - 1);
      const ops = before.map(p => ({ before: p, after: null })); if (bed) ops.push({ kind: 'bed', before: bed, after: null });
      const done = A.commit('Remove three plantings and an empty bed', ops, { unchecked: true }), n = S.plan.plantings.length, beds = S.plan.beds.length; A.undo();
      return { done, n, beds, bed: !!bed, p: S.plan.plantings.map(p => p.id).join(','), b: S.plan.beds.map(b => b.id).join(','), key: A.contentKey() };""" % json.dumps(mid))
    check("three plantings and a bed removed in one step, from three places, go back to their own places in one Undo", several["done"] and several["bed"] and several["n"] == start["n"] - 3 and several["p"] == order0["p"] and several["b"] == order0["b"] and several["key"] == key0, {k: (v if k in ("done", "n", "beds", "bed") else None) for k, v in several.items()})
    redo = js("A.redo(); const n = S.plan.plantings.length; A.undo(); return { n, key: A.contentKey() }")
    check("and Redo then Undo leaves it the same again", redo["n"] == start["n"] - 3 and redo["key"] == key0, redo)
    page.evaluate("LRFApp.state.undo.length = 0; LRFApp.state.redo.length = 0")

    # ══ the To settle fix for bed lengths ══
    page.evaluate("LRFPanels.showSettle()"); wait(500)
    settle = js("""const fixes = [...document.querySelectorAll('#toSettle .fix')].map(f => ({ title: f.querySelector('.fix-title').textContent, text: f.querySelector('p').textContent, buttons: [...f.querySelectorAll('.fix-btn')].map(b => ({ b: b.querySelector('b').textContent, small: (b.querySelector('small') || {}).textContent || '', layout: b.dataset.fix === 'layout' })) }));
      return { count: LRFPanels.settleCount(), long: fixes.filter(f => f.buttons.some(b => b.layout)), words: txt('toSettle') };""")
    check("To settle lists at least one garden whose plantings are longer than its beds, with a fix that leads to the layout", len(settle["long"]) >= 1, settle["count"])
    if settle["long"]:
        fix = settle["long"][0]; lay = [b for b in fix["buttons"] if b["layout"]][0]
        import re
        want = float(re.search(r"to ([\d.,]+) ft", lay["b"]).group(1).replace(",", ""))
        check("its words say where it goes and that nothing changes until it is set there; no fix says “The beds are N ft” any more", "in Edit layout…" in lay["b"] and "Nothing changes until you set it" in lay["small"] and "The beds are" not in settle["words"] and len(fix["buttons"]) == 2 and fix["buttons"][0]["b"].startswith("Make "), fix)
        mates = js(f"const g = S.plan.gardens.find(g => g.name === {json.dumps(fix['title'])}); return S.plan.beds.filter(b => b.gardenId === g.id && b.active !== false && eng.isSoilBed(b)).map(b => ({{ id: b.id, l: b.l }}));")
        click("#toSettle [data-fix=layout]", 800)
        opened = js("""const f = $('fLayL'); return { on: document.body.dataset.layout === 'on', picked: LRFMapEdit.picked().slice().sort(), value: f && f.value, proposed: f && f.dataset.proposed, focus: document.activeElement && document.activeElement.id, now: txt('leLength'), offer: txt('leOffer'), key: A.contentKey(), undo: S.undo.length,
          lengths: LRFMapEdit.picked().map(id => eng.bedOf(id).l), line: line('#layoutPanel') };""") if js("return typeof LRFMapEdit.picked === 'function'") else js("""const f = $('fLayL'); return { on: document.body.dataset.layout === 'on', picked: LRFMapEdit.picked.slice().sort(), value: f && f.value, proposed: f && f.dataset.proposed, focus: document.activeElement && document.activeElement.id, now: txt('leLength'), offer: txt('leOffer'), key: A.contentKey(), undo: S.undo.length,
          lengths: LRFMapEdit.picked.map(id => eng.bedOf(id).l), line: line('#layoutPanel') };""")
        check("a press opens Edit layout with that garden's beds picked, all of them and no other", opened["on"] and opened["picked"] == sorted(m["id"] for m in mates), {"picked": len(opened["picked"]), "mates": len(mates)})
        check("the wanted length is in the length field, marked as offered, with the field ready to type in", float(opened["value"] or 0) == want and float(opened["proposed"] or 0) == want and opened["focus"] == "fLayL", opened)
        check("and nothing has changed: the beds are the length they were, the plan is the same, there is nothing to undo", opened["key"] == key0 and opened["undo"] == 0 and opened["lengths"] == [m["l"] for m in mates] and str(mates[0]["l"]).rstrip("0").rstrip(".") in opened["now"], opened)
        check("a box under the field says it is not set yet, where the figure comes from, and what the beds are now", "Not set yet" in opened["offer"] and "is what is planted in" in opened["offer"] and "now" in opened["offer"] and has("#leOfferSet") and has("#leOfferDrop"), opened["offer"])
        check("the layout's panel has the same quiet line under its heading", bool(opened["line"]) and opened["line"]["state"] == "idle" and opened["line"]["after"] == "HEADER", opened["line"])
        shot("offer")
        click("#leOfferDrop")
        dropped = js("const f = $('fLayL'); return { offer: !!$('leOffer'), value: f && f.value, proposed: f && f.dataset.proposed || null, key: A.contentKey() }")
        check("“Leave them as they are” takes the offer away and changes nothing", not dropped["offer"] and float(dropped["value"] or 0) == mates[0]["l"] and dropped["proposed"] is None and dropped["key"] == key0, dropped)
        # a length that would lay beds on other ground is refused there, by name
        page.evaluate("ids => LRFMapEdit.open({ bedIds: ids, propose: { l: 900, why: 'a made-up length' } })", [m["id"] for m in mates]); wait(400)
        click("#leOfferSet", 500)
        clash = js("return { key: A.contentKey(), line: line('#layoutPanel'), offer: !!$('leOffer'), toast: txt('toast'), undo: S.undo.length }")
        check("a length that would lay a bed on other ground is refused under the layout's guard rail: nothing changes, and the panel says so in red, by name", clash["key"] == key0 and clash["undo"] == 0 and bool(clash["line"]) and clash["line"]["state"] == "refused" and "would lie on" in clash["line"]["text"] and clash["offer"], clash)
        shot("offer-refused")
        # set it, by the button
        page.evaluate("LRFMapEdit.close()"); wait(200); page.evaluate("LRFPanels.showSettle()"); wait(400); click("#toSettle [data-fix=layout]", 800)
        click("#leOfferSet", 600)
        done = js(f"const ids = {json.dumps([m['id'] for m in mates])}; return {{ lengths: ids.map(id => eng.bedOf(id).l), others: S.plan.beds.filter(b => !ids.includes(b.id)).length, undo: S.undo.length, offer: !!$('leOffer'), line: line('#layoutPanel'), field: ($('fLayL') || {{}}).value, proposed: ($('fLayL') || {{}}).dataset.proposed || null, count: LRFPanels.settleCount(), now: txt('leLength') }}")
        check("“Set all N to L ft” sets them there, in one step, and the panel says Saved with its Undo", all(l == want for l in done["lengths"]) and done["undo"] == 1 and not done["offer"] and done["proposed"] is None and bool(done["line"]) and done["line"]["state"] == "saved" and done["line"]["undo"], done)
        check("that garden then leaves the To settle count", done["count"] == settle["count"] - 1, [settle["count"], done["count"]])
        page.evaluate("LRFApp.undo()"); wait(300)
        check("one Undo puts every bed back, and the plan is as it was", js("return A.contentKey()") == key0)
        # by the keyboard: Enter in the field
        page.evaluate("LRFMapEdit.close()"); wait(200); page.evaluate("LRFPanels.showSettle()"); wait(400); click("#toSettle [data-fix=layout]", 800)
        page.keyboard.press("Enter"); wait(500)
        entered = js(f"const ids = {json.dumps([m['id'] for m in mates])}; return {{ lengths: ids.map(id => eng.bedOf(id).l), undo: S.undo.length }}")
        check("Enter in the field sets the offered length too", all(l == want for l in entered["lengths"]) and entered["undo"] == 1, entered)
        page.evaluate("LRFApp.undo()"); wait(300)
        page.evaluate("LRFMapEdit.close()"); wait(200)
    check("after the layout the plan is as it was", js("return A.contentKey()") == key0)
    page.evaluate("LRFApp.state.undo.length = 0; LRFApp.state.redo.length = 0")

    # ══ personal use or commercial ══
    worth0 = js("return worth()")
    pick(sub["one"])
    grown = js("""const seg = $('fUse'); return { there: !!seg, use: seg && seg.dataset.use, by: seg && seg.dataset.by, pressed: seg ? [...seg.querySelectorAll('button')].map(b => [b.dataset.use, b.textContent, b.getAttribute('aria-pressed'), b.getBoundingClientRect().height]) : [], help: (document.querySelector('#fUseField small') || {}).textContent, label: (document.querySelector('#fUseField > span') || {}).textContent, line: txt('fYieldLine') };""")
    check("a planting's panel has “Grown for”: Commercial or Personal use, in his words, Commercial until he says otherwise", grown["there"] and grown["label"] == "Grown for" and [p[:3] for p in grown["pressed"]] == [["commercial", "Commercial", "true"], ["personal", "Personal use", "false"]] and grown["by"] == "default" and all(p[3] < 40 for p in grown["pressed"]) and "$" in grown["line"], grown)
    dates0 = js(f"const r = eng.calc(eng.planting({json.dumps(sub['one'])})); return [+r.first, +r.last, r.plants, eng.yieldOf(eng.planting({json.dumps(sub['one'])}), r).units].join('/')")
    click("#fUse [data-use=personal]", 450)
    marked = js(f"""const p = eng.planting({json.dumps(sub['one'])}), r = eng.calc(p), seg = $('fUse'); return {{ use: p.use, worth: worth(), dates: [+r.first, +r.last, r.plants, eng.yieldOf(p, r).units].join('/'), toast: txt('toast'), pressed: seg ? seg.querySelector('[aria-pressed=true]').dataset.use : '', by: seg && seg.dataset.by,
      line: txt('fYieldLine'), help: (document.querySelector('#fUseField small') || {{}}).textContent, undo: S.undo.length, key: A.contentKey(), saved: line('#inspectorBody'), n: F.build(eng).personal }};""")
    check("Personal use, pressed: the planting carries the word, in one step, and the plan counts as changed (so it is stored and sent)", marked["use"] == "personal" and marked["undo"] == 1 and marked["key"] != key0 and marked["pressed"] == "personal" and marked["by"] == "planting" and marked["n"] == 1, marked)
    check("the season's worth falls by exactly that planting's dollars", abs((worth0 - marked["worth"]) - sub["oneDollars"]) < 0.005 and sub["oneDollars"] > 0, [worth0, marked["worth"], sub["oneDollars"]])
    money = lambda n: "$" + f"{round(n):,}"
    check("and it is said at the time: one planting left out of revenue, the season's worth before and after, with Undo", "1 planting is left out of revenue" in marked["toast"] and f"from {money(worth0)} to {money(marked['worth'])}" in marked["toast"] and "Undo" in marked["toast"] and "personal use" in marked["toast"], marked["toast"])
    check("its dates, its plants and its yield are what they were; the panel says the yield is for personal use and gives no dollars", marked["dates"] == dates0 and "personal use" in marked["line"] and "$" not in marked["line"] and "Set on this planting" in marked["help"] and bool(marked["saved"]) and marked["saved"]["state"] == "saved", marked)
    shot("personal-planting")
    click("#fUse [data-use=commercial]", 450)
    unmarked = js(f"return {{ has: 'use' in eng.planting({json.dumps(sub['one'])}), key: A.contentKey(), worth: worth(), toast: txt('toast') }}")
    check("Commercial, pressed again: nothing is kept on the planting (it follows its bed), so the plan is the one he started from", not unmarked["has"] and unmarked["key"] == key0 and abs(unmarked["worth"] - worth0) < 0.005 and "counts as revenue again" in unmarked["toast"], unmarked)
    # the bed
    pick_bed(sub["bedId"])
    bed_says = js("const el = $('bedUse'); return { there: !!el, use: el && el.dataset.use, by: el && el.dataset.by, text: el && el.textContent, link: !!$('bedUseEdit'), fields: document.querySelectorAll('#inspectorBody input, #inspectorBody select').length }")
    check("a bed's panel says whom it is grown for, and changes nothing itself: a link leads to the layout", bed_says["there"] and bed_says["use"] == "commercial" and "Grown for" in bed_says["text"] and bed_says["link"] and bed_says["fields"] == 0, bed_says)
    click("#bedUseEdit", 700)
    in_layout = js("const el = $('leUse'); return { on: document.body.dataset.layout === 'on', there: !!el, value: el && el.value, scope: el && el.dataset.scope, focus: document.activeElement && document.activeElement.id, key: A.contentKey() }")
    check("the link opens Edit layout with that bed picked and “Grown for” ready: for the bed, Commercial, nothing changed", in_layout["on"] and in_layout["there"] and in_layout["value"] == "commercial" and in_layout["scope"] == "bed" and in_layout["focus"] == "leUse" and in_layout["key"] == key0, in_layout)
    if has("#leUse"): page.select_option("#leUse", "personal"); wait(500)
    bed_marked = js(f"""const ids = {json.dumps(sub['bedIds'])}; return {{ bed: eng.bedOf({json.dumps(sub['bedId'])}).use, uses: ids.map(id => F.useOf(eng, eng.planting(id))).map(u => u.use + ':' + u.by), own: ids.filter(id => 'use' in eng.planting(id)).length, elsewhere: S.plan.plantings.filter(p => !ids.includes(p.id) && F.useOf(eng, p).personal).length,
      worth: worth(), want: dollarsOf(ids), toast: txt('toast'), undo: S.undo.length, value: ($('leUse') || {{}}).value, line: line('#layoutPanel') }};""")
    n_bed = len(sub["bedIds"])
    check("Personal use chosen there marks the bed: every planting in it follows, by the bed's word, with nothing written on any planting, and no planting elsewhere", bed_marked["bed"] == "personal" and bed_marked["uses"] == ["personal:bed"] * n_bed and bed_marked["own"] == 0 and bed_marked["elsewhere"] == 0 and bed_marked["value"] == "personal", bed_marked)
    check("the worth falls by those plantings' dollars, and the toast says how many and from what to what", abs((worth0 - bed_marked["worth"]) - bed_marked["want"]) < 0.005 and f"{n_bed} planting" in bed_marked["toast"] and "left out of revenue" in bed_marked["toast"] and f"to {money(bed_marked['worth'])}" in bed_marked["toast"] and bool(bed_marked["line"]) and bed_marked["line"]["state"] == "saved", bed_marked)
    shot("personal-bed-layout")
    page.evaluate("LRFMapEdit.close()"); wait(200)
    pick(sub["two"])
    follows = js("const seg = $('fUse'); return { pressed: seg && seg.querySelector('[aria-pressed=true]').dataset.use, by: seg && seg.dataset.by, help: (document.querySelector('#fUseField small') || {}).textContent, line: txt('fYieldLine') }")
    check("a planting in that bed shows Personal use, and says it follows its bed", follows["pressed"] == "personal" and follows["by"] == "bed" and "Follows its bed" in follows["help"] and "$" not in follows["line"], follows)
    click("#fUse [data-use=commercial]", 450)
    part = js(f"""const p = eng.planting({json.dumps(sub['two'])}), ids = {json.dumps(sub['bedIds'])}.filter(id => id !== p.id); return {{ use: p.use, by: F.useOf(eng, p).by, worth: worth(), want: dollarsOf(ids), help: (document.querySelector('#fUseField small') || {{}}).textContent, line: txt('fYieldLine'), toast: txt('toast') }};""")
    check("Commercial pressed on it is kept on the planting, since its bed says otherwise: a bed that is part personal", part["use"] == "commercial" and part["by"] == "planting" and abs((worth0 - part["worth"]) - part["want"]) < 0.005 and "Its bed is for personal use" in part["help"] and "$" in part["line"] and "counts as revenue again" in part["toast"], part)
    pick_bed(sub["bedId"])
    check("the bed's panel now says personal use", js("const el = $('bedUse'); return el && el.dataset.use === 'personal' && el.dataset.by === 'bed' && /personal use/.test(el.textContent)"))
    # the whole garden
    page.evaluate("id => { LRFMapEdit.open({}); LRFMapEdit.pickGarden(id); }", sub["gardenId"]); wait(500)
    whole = js("const el = $('leUse'); return { there: !!el, scope: el && el.dataset.scope, value: el && el.value, label: el && el.closest('.field').querySelector('span').textContent }")
    check("with a whole garden picked, “Grown for” is the garden's", whole["there"] and whole["scope"] == "garden" and whole["value"] == "commercial" and "whole garden" in whole["label"], whole)
    if has("#leUse"): page.select_option("#leUse", "personal"); wait(500)
    garden = js(f"""const ids = {json.dumps(sub['gardenIds'])}, g = S.plan.gardens.find(g => g.id === {json.dumps(sub['gardenId'])}); return {{ garden: g.use, personal: ids.filter(id => F.useOf(eng, eng.planting(id)).personal).length, kept: F.useOf(eng, eng.planting({json.dumps(sub['two'])})).use, other: F.useOf(eng, eng.planting({json.dumps(sub['otherPlanting'])})).by,
      elsewhere: S.plan.plantings.filter(p => !ids.includes(p.id) && F.useOf(eng, p).personal).length, worth: worth(), want: dollarsOf(ids.filter(id => id !== {json.dumps(sub['two'])})), toast: txt('toast') }};""")
    check("Personal use chosen there marks the garden: its other beds follow by the garden's word, the planting that said commercial still says so, and nothing outside the garden is touched", garden["garden"] == "personal" and garden["personal"] == len(sub["gardenIds"]) - 1 and garden["kept"] == "commercial" and garden["other"] == "garden" and garden["elsewhere"] == 0 and abs((worth0 - garden["worth"]) - garden["want"]) < 0.005 and "left out of revenue" in garden["toast"], garden)
    page.evaluate("LRFMapEdit.close()"); wait(200)
    pick_bed(sub["otherBed"])
    check("another bed of that garden says it is for personal use as all of the garden is", js("const el = $('bedUse'); return el && el.dataset.use === 'personal' && el.dataset.by === 'garden' && el.textContent.includes('as all of')"))

    # ── the Harvest page, and the list that is sent ──
    page.evaluate("LRFApp.setView('harvest')"); wait(600)
    hv = js("""const m = F.build(eng, { year: A.planYear() }), c = F.build(eng, { year: A.planYear(), use: 'commercial' }), o = F.build(eng, { year: A.planYear(), use: 'personal' });
      const seg = $('hvUse'), tiles = [...document.querySelectorAll('#hvTiles .tr-stat')].map(x => x.textContent), rows = () => [...document.querySelectorAll('#hvTable tr.hv-row')].length;
      return { seg: seg ? [...seg.querySelectorAll('button')].map(b => [b.dataset.hvUse, b.textContent, b.getAttribute('aria-pressed'), b.getBoundingClientRect().height]) : null, tiles, note: txt('hvOwnNote'), foot: (document.querySelector('#hvTable tfoot .hv-name') || {}).textContent, footWorth: (document.querySelector('#hvTable tfoot .hv-total') || {}).textContent,
        rows: rows(), want: { all: m.rows.filter(r => r.total > 0).length, commercial: c.rows.filter(r => r.total > 0).length, personal: o.rows.filter(r => r.total > 0).length, marked: m.personal, worth: m.rows.reduce((n, r) => n + r.worth, 0) }, side: document.documentElement.scrollWidth > innerWidth + 1 };""")
    check("once something is marked, Harvest offers Everything, Commercial and Personal use, and opens on Everything", hv["seg"] is not None and [s[:3] for s in hv["seg"]] == [["all", "Everything", "true"], ["commercial", "Commercial", "false"], ["personal", "Personal use", "false"]] and all(s[3] < 40 for s in hv["seg"]) and hv["rows"] == hv["want"]["all"] and not hv["side"], hv)
    check("its headline figures say which plantings they count: personal use included in what is ready, commercial only in the worth", "personal use included" in hv["tiles"][0] and "commercial plantings only" in hv["tiles"][1] and money(hv["want"]["worth"]) in hv["tiles"][1] and hv["footWorth"] == money(hv["want"]["worth"]) and "grown to sell" in hv["foot"], hv["tiles"][:2])
    check("a note under the table says how many plantings are marked and what that does", f"{hv['want']['marked']} planting" in hv["note"] and "A list to send" in hv["note"], hv["note"])
    shot("harvest-everything")
    click("#hvUse [data-hv-use=commercial]")
    hc = js("return { rows: document.querySelectorAll('#hvTable tr.hv-row').length, tile: document.querySelector('#hvTiles .tr-stat').textContent, use: LRFHarvestView.use() }")
    check("Commercial shows only what is grown to sell", hc["rows"] == hv["want"]["commercial"] and "commercial only" in hc["tile"] and hc["use"] == "commercial", hc)
    click("#hvUse [data-hv-use=personal]")
    hp = js("return { rows: document.querySelectorAll('#hvTable tr.hv-row').length, tiles: [...document.querySelectorAll('#hvTiles .tr-stat')].map(x => x.textContent), foot: (document.querySelector('#hvTable tfoot .hv-total') || {}).textContent }")
    check("Personal use shows only what is marked, and that it is worth nothing as revenue", hp["rows"] == hv["want"]["personal"] and hp["rows"] >= 1 and "personal use only" in hp["tiles"][0] and "$0" in hp["tiles"][1] and "not counted as revenue" in hp["tiles"][1] and hp["foot"] == "$0", hp)
    shot("harvest-personal")
    click("#hvShareBtn", 500)
    if has("#hvShareRange"): page.select_option("#hvShareRange", "months"); wait(300)
    sent = js("""const c = F.build(eng, { year: A.planYear(), use: 'commercial' }), m = F.build(eng, { year: A.planYear() }), s = F.season(c), sm = F.season(m), farm = S.plan.settings.farm || 'Farm';
      const want = F.text(c, F.periods(c, 'month', s.i0, s.i1), { farm, grain: 'month', varieties: false, prices: false, group: undefined }), everything = F.text(m, F.periods(m, 'month', sm.i0, sm.i1), { farm, grain: 'month', varieties: false, prices: false, group: undefined });
      return { same: txt('hvSheet') === want, differs: want !== everything, note: txt('hvShareOwn'), marked: m.personal };""")
    check("“A list to send…” is made from what is grown to sell, whatever the page is showing, and says how many plantings it leaves out", sent["same"] and sent["differs"] and f"{sent['marked']} planting" in sent["note"] and "left out of this list" in sent["note"], sent)
    shot("list-to-send")
    page.keyboard.press("Escape"); wait(200)
    # the weekly amount takes off what the plan gives to sell
    page.evaluate("id => LRFApp.openAhead({ mode: 'series', by: 'harvest', cropId: id })", sub["cropId"]); wait(700)
    net = js("return { text: txt('srNetText'), there: !!$('srNet') }")
    check("the weekly amount says that plantings for personal use are not counted as giving any of what is wanted", net["there"] and "personal use are not counted" in net["text"], net)
    page.evaluate("LRFApp.select(null)"); wait(200)

    # ── all of it taken back ──
    steps = js("return S.undo.length")
    for _ in range(steps): page.evaluate("LRFApp.undo()")
    wait(300)
    end = js("return { key: A.contentKey(), marked: F.build(eng).personal, p: S.plan.plantings.map(p => p.id).join(','), b: S.plan.beds.map(b => b.id).join(','), g: S.plan.gardens.map(g => g.id).join(','), worth: worth() }")
    check("every mark taken back by Undo: nothing is marked, the worth is what it was, and the plan is the one he started from, record for record and in the same order", steps >= 4 and end["key"] == key0 and end["marked"] == 0 and end["p"] == order0["p"] and end["b"] == order0["b"] and end["g"] == order0["g"] and abs(end["worth"] - worth0) < 0.005, {"steps": steps, "key": end["key"] == key0, "marked": end["marked"]})
    page.evaluate("LRFApp.setView('harvest')"); wait(500)
    plainh = js("return { seg: !!$('hvUse'), note: !!$('hvOwnNote'), tiles: [...document.querySelectorAll('#hvTiles .tr-stat')].map(x => x.textContent).join(' '), foot: (document.querySelector('#hvTable tfoot .hv-name') || {}).textContent }")
    check("with nothing marked, Harvest is as it was: no choice of whom it is grown for, no note, and no figure says commercial or personal", not plainh["seg"] and not plainh["note"] and "commercial" not in plainh["tiles"] and "personal" not in plainh["tiles"] and plainh["foot"] == "Worth, at each crop’s own price", plainh)
    page.evaluate("LRFApp.setView('map')"); wait(300)
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
