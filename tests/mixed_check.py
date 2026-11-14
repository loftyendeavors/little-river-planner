"""Previews 0.35 and 0.36 (the bed panel build, stage c: mixed beds) in a real browser: a crop dragged onto a bed that is held is asked,
at the bed, whether to split the length, split the rows or replace; after a split the bed is being mixed and the next drops
split it again without asking; the line between two shares is dragged on the map; several varieties are ticked in a planting's
panel; a planting is sent to To place; a planting that is replaced waits there with its date. And the farm photo is kept when
a plan arrives with variety photos and none of the farm.
usage: python3 -I mixed_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, R = LRFRails, $ = id => document.getElementById(id), eng = S.engine, txt = id => ($(id) || {}).textContent || '';"
       "const worth = () => F.build(eng).rows.reduce((n, r) => n + r.worth, 0);"
       "const inBed = id => eng.plantingsIn(id).map(p => { const r = eng.calc(p), f = eng.footprint(p, r); return { id: p.id, date: p.date, a0: f.a0, a1: Math.min(f.a1, r.cap), x0: f.x0, x1: f.x1, len: r.physicalLength, plants: r.plants, first: +r.first, last: +r.last, variety: p.varietyId || '' }; }).sort((a, b) => (a.a0 - b.a0) || (a.x0 - b.x0));"
       "const ask = () => { const el = $('shareAsk'); if (!el) return null; const r = el.getBoundingClientRect(); return { head: (el.querySelector('.share-ask-head b') || {}).textContent, sub: (el.querySelector('.share-ask-head small') || {}).textContent, ways: [...el.querySelectorAll('.fix-btn')].map(b => [b.dataset.way, b.querySelector('b').textContent, b.querySelector('small').textContent]), not: txt('shareAskNot'), box: [r.left, r.top, r.right, r.bottom], inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark" if DARK else "light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    def ready():
        page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    page.goto(url); ready()
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)
    page.evaluate("LRFApp.state.undo.length = 0")
    js = lambda body, arg=None: page.evaluate("(arg) => { " + PRE + " " + body + " }", arg)
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0
    def click(sel, ms=350):
        if not has(sel): wait(100); return False
        page.locator(sel).first.click(); wait(ms); return True
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    money = lambda n: "$" + f"{round(n):,}"
    key0 = js("return A.contentKey()")
    order0 = js("return S.plan.plantings.map(p => p.id).join(',')")
    start = js("return { n: S.plan.plantings.length, undo: S.undo.length, label: txt('buildNote'), waiting: A.waiting().length, settle: LRFPanels.settleCount() }")
    check("a plan is open with nothing to undo; the build says 0.39", start["n"] > 300 and start["undo"] == 0 and "0.39" in start["label"], start)
    sub = js("""for (const b of S.plan.beds) { if (!eng.isSoilBed(b) || !(eng.capOf(b) >= 30) || b.active === false || eng.plantingsIn(b.id).length !== 1) continue;   // alone in its bed for the whole season: the lines below count everything the bed holds
        for (const p of eng.plantingsIn(b.id)) { const r = eng.calc(p); if (!r || p.bedLayout || p.ft > 0 || r.partial || !p.varietyId || R.fixed(eng, { p }) || eng.varietiesOf(p.cropId).length < 5 || r.rows !== 2) continue;
          if (eng.holders(b, eng.occupancyFrom(p, r), eng.occupancyThrough(p, r), p.id).length) continue;
          const other = S.plan.beds.find(o => o.gardenId === b.gardenId && o.id !== b.id && eng.isSoilBed(o));
          return { id: p.id, bedId: b.id, bed: A.bedLabel(b), gardenId: b.gardenId, cropId: p.cropId, crop: eng.crop(p.cropId).name, label: A.cropLabel(p), own: eng.variety(p.varietyId).name, others: eng.varietiesOf(p.cropId).filter(v => v.id !== p.varietyId).map(v => v.id), date: E.d2s(E.addDays(r.field, 10)), pdate: p.date, cap: eng.capOf(b), plants: r.plants, rows: r.rows, dates: [+r.first, +r.last].join('/'), otherBed: other && other.id }; } }
      return null;""")
    check("a subject is found: a planting alone in a whole bed of two rows, with four other varieties of its crop", bool(sub) and bool(sub and sub["otherBed"]), sub)
    if not sub: finish()
    js("A.setDate(E.s2d(arg.date)); LRFMap.fitGarden(arg.gardenId);", sub); wait(900)
    drop = lambda k, extra="{}": (js("A.place({ cropId: arg[0].cropId, varietyId: arg[0].others[arg[1]] }, arg[0].bedId, S.date, %s);" % extra, [sub, k]), wait(450))
    bed_box = lambda: js("const r = document.querySelector('#mapBeds [data-bed=\"' + arg.bedId + '\"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };", sub)

    # ══ the drop that asks ══
    seen = js("const a = A.preview({ cropId: arg.cropId, varietyId: arg.others[0] }, { bedId: arg.bedId, date: S.date }), q = A.preview({ cropId: arg.cropId, varietyId: arg.others[0] }, { bedId: arg.bedId, date: S.date, survey: true }); return { state: a.state, text: a.text, survey: q.state };", sub)
    check("while a crop is in the air, a bed that is held says who holds it and that a drop will split or replace", seen["state"] == "split" and seen["survey"] == "split" and "Held by" in seen["text"] and "drop to split or replace" in seen["text"], seen)
    # a real drag from the crop library onto the bed
    row = js("const el = document.querySelector('.lib-row[data-crop=\"' + arg.cropId + '\"]:not(.lib-var)'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) };", sub)
    check("the crop is in the library to drag", bool(row), row)
    box = bed_box()
    if row:
        page.mouse.move(row["x"], row["y"]); page.mouse.down(); page.mouse.move(row["x"] + 30, row["y"] + 10, steps=3); page.mouse.move(box["cx"], box["cy"], steps=12); wait(250)
        hint = js("const g = document.querySelector('.drag-ghost'); return g ? { state: g.dataset.state, text: g.textContent, cls: document.querySelector('#mapBeds [data-bed=\"' + arg.bedId + '\"]').closest('.bed').getAttribute('class') } : null;", sub)
        check("dragged over that bed by a real mouse, the hint says the same and the bed is drawn as one a drop can split", bool(hint) and hint["state"] == "split" and "drop to split or replace" in hint["text"] and "drop-split" in hint["cls"], hint)
        page.mouse.up(); wait(450)
    asked = js("return { ask: ask(), key: A.contentKey(), undo: S.undo.length }")
    a = asked["ask"]
    check("let go, nothing is planted yet: a question opens at the bed, in view and clear of the bed itself", bool(a) and asked["key"] == key0 and asked["undo"] == 0 and a["inView"] and (a["box"][0] >= box["x"] + box["w"] or a["box"][2] <= box["x"]), {"ask": a, "bed": box})
    check("it says who holds the bed and until when, and that no date changes", bool(a) and sub["bed"] in a["head"] and sub["label"] in a["head"] and "No date changes" in a["sub"], a)
    half = sub["cap"] / 2
    num = lambda n: f"{n:g}"
    check("it offers three ways, each saying what it does before it is pressed: split the length, split the rows, replace", bool(a) and [w[0] for w in a["ways"]] == ["length", "rows", "replace"] and f"take {num(half)} ft each of {num(sub['cap'])}" in a["ways"][0][2] and f"from {sub['plants']} plants to" in a["ways"][0][2] and "keeps 1 of 2 rows" in a["ways"][1][2] and "waits under To place, with its date" in a["ways"][2][2], a)
    shot("the-question")
    click("#shareAskClose")
    check("its × leaves without doing anything", js("return { ask: !!$('shareAsk'), key: A.contentKey() }") == {"ask": False, "key": key0})
    drop(0); page.keyboard.press("Escape"); wait(250)
    check("Escape does the same", js("return { ask: !!$('shareAsk'), key: A.contentKey(), mixing: A.mixing() }") == {"ask": False, "key": key0, "mixing": None})
    drop(0)
    spot = js("const r = $('timebar') ? $('timebar').getBoundingClientRect() : document.querySelector('.timebar, #dateBar, footer').getBoundingClientRect(); return { x: Math.round(r.left + 8), y: Math.round(r.top + 4) };") if js("return !!($('timebar') || document.querySelector('.timebar, #dateBar, footer'))") else {"x": 5, "y": 5}
    page.mouse.click(spot["x"], spot["y"]); wait(250)
    check("and so does a click anywhere else", js("return { ask: !!$('shareAsk'), key: A.contentKey() }") == {"ask": False, "key": key0})

    # ══ split the length, and mixing ══
    worth0 = js("return worth()")
    drop(0); click("#shareAsk [data-way=length]", 600)
    one = js("""const list = inBed(arg.bedId), bedEl = document.querySelector('#mapBeds [data-bed="' + arg.bedId + '"]').closest('.bed'); return { list, undo: S.undo.length, toast: txt('toast'), mixing: A.mixing(), pill: $('mixPill') && !$('mixPill').hidden ? txt('mixPillText') : null, pillBox: $('mixPill') ? (r => r.left >= 0 && r.right <= innerWidth + 1 && $('mixPill').scrollWidth <= $('mixPill').clientWidth + 1)($('mixPill').getBoundingClientRect()) : false,
      marked: bedEl.hasAttribute('data-mixing'), sel: S.sel, worth: worth(), saved: (document.querySelector('#inspectorBody .insp-saved') || {}).textContent, label: S.undo.length ? S.undo[S.undo.length - 1].label : '' };""", sub)
    L = one["list"]
    check("“Split the length”: two plantings share the bed, half each, end to end, in one step", len(L) == 2 and abs(L[0]["len"] - half) < 1e-6 and abs(L[1]["len"] - half) < 1e-6 and abs(L[0]["a1"] - L[1]["a0"]) < 1e-6 and abs(L[1]["a1"] - sub["cap"]) < 1e-6 and one["undo"] == 1, one)
    check("the crop that was there keeps its date and its harvest; the newcomer has the day it was dropped on and is selected", L[0]["id"] == sub["id"] and L[0]["date"] == sub["pdate"] and f"{L[0]['first']}/{L[0]['last']}" == sub["dates"] and L[1]["date"] == sub["date"] and one["sel"] == {"type": "planting", "id": L[1]["id"]}, one)
    check("it is said at the time: where it went, how many feet, and the season's worth before and after", sub["bed"] in one["toast"] and f"{num(half)} ft" in one["toast"] and ("the season’s worth goes from " + money(worth0) + " to " + money(one["worth"]) in one["toast"] or "the season’s worth stays " + money(one["worth"]) in one["toast"]) and "Undo" in one["toast"] and (one["saved"] or "").startswith("Saved"), one["toast"])
    check("the bed is now being mixed: a pill on the map says so, with its plantings, their feet and Done, and the bed is outlined", one["mixing"] == {"bedId": sub["bedId"], "by": "length"} and bool(one["pill"]) and sub["bed"] in one["pill"] and "2 plantings" in one["pill"] and f"{num(half)} ft each" in one["pill"] and one["pillBox"] and one["marked"] and has("#mixDone"), one)
    hint2 = js("const a = A.preview({ cropId: arg.cropId, varietyId: arg.others[1] }, { bedId: arg.bedId, date: S.date }); return { state: a.state, text: a.text };", sub)
    check("the next crop in the air is told it will split the bed again, and into what", hint2["state"] == "split" and "Splits again" in hint2["text"] and f": {num(round(sub['cap'] / 3, 1))} ft each" in hint2["text"], hint2)   # a third of whatever bed was found, written as the page writes a figure: one decimal, and none when it is whole
    drop(1)
    two = js("return { ask: !!$('shareAsk'), list: inBed(arg.bedId), undo: S.undo.length, toast: txt('toast'), pill: txt('mixPillText'), marked: document.querySelector('#mapBeds [data-bed=\"' + arg.bedId + '\"]').closest('.bed').hasAttribute('data-mixing') }", sub)
    third = sub["cap"] / 3
    check("the next variety dropped on it splits it again without asking: three equal shares, exact to the bed, one more step", not two["ask"] and len(two["list"]) == 3 and all(abs(x["len"] - third) < 1e-6 for x in two["list"]) and abs(two["list"][2]["a1"] - sub["cap"]) < 1e-6 and two["undo"] == 2 and "as each of the 3 has" in two["toast"] and "3 plantings" in two["pill"], two)
    check("and the bed is still outlined as the one being mixed: the map was drawn afresh by that drop", two["marked"] is True, two["marked"])
    shot("mixing")
    click("#mixDone", 250)
    done = js("return { mixing: A.mixing(), pill: $('mixPill').hidden, marked: !!document.querySelector('#mapBeds .bed[data-mixing]') }")
    check("Done ends the mixing: the pill goes and the bed is drawn as any other", done == {"mixing": None, "pill": True, "marked": False}, done)
    drop(2)
    again = js("return ask()")
    check("after Done, a drop on that bed asks again; with three in it the rows are not offered, since two rows do not divide by four", bool(again) and [w[0] for w in again["ways"]] == ["length", "replace"] and "All 4 take" in again["ways"][0][2] and "and 2 more" in again["head"], again)
    click("#shareAsk [data-way=length]", 600)
    page.keyboard.press("Escape"); wait(250)
    esc = js("return { mixing: A.mixing(), n: inBed(arg.bedId).length, undo: S.undo.length }", sub)
    check("four in the bed; Escape ends the mixing and undoes nothing", esc == {"mixing": None, "n": 4, "undo": 3}, esc)
    drop(3); click("#shareAsk [data-way=length]", 600)
    js("A.select({ type: 'bed', id: arg.otherBed })", sub); wait(250)
    away = js("return { mixing: A.mixing(), n: inBed(arg.bedId).length }", sub)
    check("five in the bed; selecting another bed ends the mixing too", away == {"mixing": None, "n": 5}, away)
    five = js("return { list: inBed(arg.bedId), settle: LRFPanels.settleCount(), outside: S.plan.plantings.filter(p => p.bedId !== arg.bedId).length }", sub)
    check("five equal shares that add up to the bed; nothing new waits under To settle and no other bed is touched", all(abs(x["len"] - sub["cap"] / 5) < 1e-6 for x in five["list"]) and abs(five["list"][4]["a1"] - sub["cap"]) < 1e-6 and five["settle"] == start["settle"] and five["outside"] == start["n"] - 1, five)

    # ══ the line between two shares, dragged on the map ══
    ids = [x["id"] for x in five["list"]]
    js("A.select({ type: 'planting', id: arg })", ids[1]); wait(400)
    grips = js("""const grips = [...document.querySelectorAll('#mapOver .sel-grip')].map(g => { const r = g.getBoundingClientRect(); return { edge: g.dataset.handle, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
      const mid = id => { const el = document.querySelector('#mapBeds [data-planting="' + id + '"]'), r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
      return { grips, next: mid(arg[2]), prev: mid(arg[0]) };""", ids)
    check("the selected share has a handle at each end", len(grips["grips"]) == 2, grips)
    end = next((g for g in grips["grips"] if g["edge"] == "end"), None)
    if end:
        tx, ty = grips["next"]["x"], grips["next"]["y"]
        page.mouse.move(end["x"], end["y"]); page.mouse.down(); page.mouse.move(end["x"] + (tx - end["x"]) * 0.3, end["y"] + (ty - end["y"]) * 0.3, steps=4); page.mouse.move(end["x"] + (tx - end["x"]) * 0.6, end["y"] + (ty - end["y"]) * 0.6, steps=4); wait(200)
        tip = js("return { other: txt('tipOther'), key: A.contentKey() }")
        page.mouse.up(); wait(450)
        slid = js("return { list: inBed(arg.bedId), undo: S.undo.length, label: S.undo[S.undo.length - 1].label, saved: (document.querySelector('#inspectorBody .insp-saved') || {}).textContent }", sub)
        M = slid["list"]; fifth = sub["cap"] / 5
        check("while its end is pushed into its neighbour, the tip says what the neighbour keeps, and nothing has changed yet", "keeps" in tip["other"] and " ft" in tip["other"] and tip["key"] != key0, tip)
        check("let go, the line between the two has moved: one grew by what the other gave up, the other three are as they were, in one step", M[1]["len"] > fifth + 0.9 and abs(M[1]["len"] + M[2]["len"] - 2 * fifth) < 1e-6 and abs(M[1]["a1"] - M[2]["a0"]) < 1e-6 and all(abs(M[i]["len"] - fifth) < 1e-6 for i in (0, 3, 4)) and slid["undo"] == 5 and slid["label"].startswith("Move the line between") and (slid["saved"] or "").startswith("Saved"), slid)
        check("lengths moved by hand are whole feet at the line", abs(M[1]["a1"] - round(M[1]["a1"])) < 1e-6, M[1])
    # the panel: who it shares with, and equal shares again
    mates = js("return { rows: [...document.querySelectorAll('#fMates li')].map(li => li.textContent), equal: !!$('fEqual'), label: (document.querySelector('#fMatesField > span') || {}).textContent }")
    check("the planting's panel lists who it shares the bed with and how many feet each has", len(mates["rows"]) == 5 and mates["equal"] and sub["bed"] in mates["label"] and sum("this one" in r for r in mates["rows"]) == 1 and all(" ft" in r for r in mates["rows"]), mates)
    hint3 = js("const h = eng.planting(arg[0]), f = eng.footprint(h, eng.calc(h)); const a = R.share(eng, { cropId: h.cropId }, { bedId: h.bedId, date: S.date, along: (f.a0 + Math.min(f.a1, eng.capOf(eng.bedOf(h.bedId)))) / 2 }); return a && a.length ? { equal: a.length.equal, ops: a.length.ops.length, each: a.length.each } : null;", [ids[4]])
    check("with the shares no longer equal, a drop would take half of the share it points at and leave the others", bool(hint3) and hint3["equal"] is False and hint3["ops"] == 2 and abs(hint3["each"] - sub["cap"] / 10) < 1e-6, hint3)
    click("#fEqual", 500)
    eq = js("return { list: inBed(arg.bedId), undo: S.undo.length, toast: txt('toast') }", sub)
    check("“Make them equal” gives five equal shares again, in one step, and says so", all(abs(x["len"] - sub["cap"] / 5) < 1e-6 for x in eq["list"]) and eq["undo"] == 6 and "Equal shares in" in eq["toast"] and "worth" in eq["toast"], eq)
    click("#fEqual", 400)
    check("pressed again it changes nothing and says they already are", js("return { undo: S.undo.length, toast: txt('toast') }") == {"undo": 6, "toast": "They already have equal shares."})

    # ══ send one to To place ══
    click("#fToWait", 600)
    sent = js("return { list: inBed(arg[0].bedId), waiting: A.waiting().map(w => ({ id: w.id, date: w.date, bed: w.bedId || null, why: w.wait && w.wait.why, from: w.wait && w.wait.from })), undo: S.undo.length, toast: txt('toast'), badge: $('waitBadge').hidden ? '' : txt('waitBadge'), sel: S.sel }", [sub])
    w = [x for x in sent["waiting"] if x["id"] == ids[1]]
    check("“Send to To place” takes a planting out of the bed and keeps it, with its date, under To place", len(w) == 1 and w[0]["bed"] is None and w[0]["from"] == sub["bedId"] and len(sent["waiting"]) == start["waiting"] + 1 and "to place" in sent["badge"] and "waits under To place" in sent["toast"], sent)
    check("the four it shared the bed with take up its ground in equal shares, in the same step", len(sent["list"]) == 4 and all(abs(x["len"] - sub["cap"] / 4) < 1e-6 for x in sent["list"]) and abs(sent["list"][3]["a1"] - sub["cap"]) < 1e-6 and sent["undo"] == 7, sent)
    for _ in range(js("return S.undo.length")): page.evaluate("LRFApp.undo()")
    wait(300)
    back = js("return { key: A.contentKey(), order: S.plan.plantings.map(p => p.id).join(','), waiting: A.waiting().length }")
    check("every step taken back by Undo: the plan is the one he started from, record for record and in order", back["key"] == key0 and back["order"] == order0 and back["waiting"] == start["waiting"], {"key": back["key"] == key0, "order": back["order"] == order0})

    # ══ several varieties, ticked in the planting's panel ══
    js("A.select({ type: 'planting', id: arg.id })", sub); wait(350)
    check("under Variety, the panel offers “Several varieties in this bed…”", has("#fSeveral") and "Several varieties" in (page.locator("#fSeveral").first.text_content() or ""))
    click("#fSeveral", 300)
    box0 = js("const rows = [...document.querySelectorAll('#mixPickList label')].map(l => ({ text: l.textContent, checked: l.querySelector('input').checked, disabled: l.querySelector('input').disabled, thumb: !!l.querySelector('.thumb, img, i, svg, span') })); return { rows, says: txt('mixSays'), divide: $('mixDivide') && $('mixDivide').disabled, by: [...document.querySelectorAll('#mixBy button')].map(b => [b.dataset.by, b.getAttribute('aria-pressed')]), key: A.contentKey(), clipped: [...document.querySelectorAll('#mixPick *')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'auto' && e.id !== 'mixPickList').length };")
    check("it opens, in place, the crop's varieties to tick, with this planting's own ticked and fixed; nothing can be divided until one is ticked", len(box0["rows"]) == len(sub["others"]) + 1 and sum(r["checked"] and r["disabled"] and "this planting" in r["text"] for r in box0["rows"]) == 1 and sum(r["checked"] for r in box0["rows"]) == 1 and box0["divide"] is True and "Nothing changes until" in box0["says"] and box0["by"] == [["length", "true"], ["rows", "false"]] and box0["clipped"] == 0, box0)
    def tick(n):   # one box at a time, each looked for afresh: a fault that redraws or divides on a tick fails a named line, it does not stop the check
        for _ in range(n):
            free = page.locator("#mixPickList input:not([disabled]):not(:checked)")
            if free.count() == 0: break
            free.first.click(); wait(200)   # a click, not check(): once ticked, this locator is the next box, and check() would press on
    tick(3)
    said = js("return { says: txt('mixSays'), divide: ($('mixDivide') || {}).disabled, key: A.contentKey(), undo: S.undo.length }")
    check("three ticked: it says what will happen before anything does (four plantings, a quarter of the bed each, what this one's plants come to), and nothing has changed", f"4 plantings, {num(sub['cap'] / 4)} ft each of {num(sub['cap'])}" in said["says"] and f"from {sub['plants']} plants to" in said["says"] and "same date" in said["says"] and said["divide"] is False and said["key"] == key0 and said["undo"] == 0, said)
    shot("several-varieties")
    click("#mixBy [data-by=rows]", 250)
    rows_no = js("return { says: txt('mixSays'), divide: ($('mixDivide') || {}).disabled, bad: !!$('mixSays') && $('mixSays').classList.contains('bad') }")
    check("By rows, four in a bed of two rows is refused in words and Divide is off", rows_no["divide"] is True and rows_no["bad"] and "do not divide evenly" in rows_no["says"], rows_no)
    click("#mixBy [data-by=length]", 250)   # back to a division that could be made, so that Cancel is tried where it matters
    can = js("return ($('mixDivide') || {}).disabled")
    click("#mixCancel", 250)
    check("Cancel, pressed where the bed could be divided, closes the list and changes nothing", can is False and js("return { box: !!$('mixPick'), key: A.contentKey() }") == {"box": False, "key": key0}, can)
    click("#fSeveral", 250)
    tick(3)
    click("#mixDivide", 600)
    div = js("return { list: inBed(arg.bedId), undo: S.undo.length, toast: txt('toast'), box: !!$('mixPick'), label: S.undo.length ? S.undo[0].label : '', mates: document.querySelectorAll('#fMates li').length }", sub)
    D = div["list"]
    check("“Divide the bed”: four plantings, a quarter each, each a variety of its own, all on this planting's date, in one step", len(D) == 4 and all(abs(x["len"] - sub["cap"] / 4) < 1e-6 for x in D) and len(set(x["variety"] for x in D)) == 4 and all(x["date"] == sub["pdate"] for x in D) and div["undo"] == 1 and "Divide" in div["label"] and not div["box"] and div["mates"] == 4, div)
    check("made as copies of it, the four come to the same number of plants; it says so with the season's worth", len(set(x["plants"] for x in D)) == 1 and "4 plantings" in div["toast"] and "worth" in div["toast"], [x["plants"] for x in D])
    click("#fSeveral", 250)
    box1 = js("return [...document.querySelectorAll('#mixPickList label')].filter(l => l.querySelector('input').disabled).map(l => l.textContent)")
    check("opened again, the list shows what is already in the bed", len(box1) == 4 and sum("in the bed" in t for t in box1) == 3, box1)
    click("#mixCancel", 200)
    page.evaluate("LRFApp.undo()"); wait(300)
    check("one Undo takes the whole division back", js("return A.contentKey()") == key0)

    # ══ split the rows ══
    drop(0); click("#shareAsk [data-way=rows]", 600)
    rw = js("return { list: inBed(arg.bedId), mixing: A.mixing(), pill: txt('mixPillText'), toast: txt('toast'), mates: [...document.querySelectorAll('#fMates li')].map(li => li.textContent), settle: LRFPanels.settleCount() }", sub)
    check("“Split the rows”: each has one of the two rows over the whole length, side by side, and the pill says the rows are shared", len(rw["list"]) == 2 and all(abs(x["len"] - sub["cap"]) < 1e-6 and abs((x["x1"] - x["x0"]) - 0.5) < 1e-6 for x in rw["list"]) and rw["mixing"] == {"bedId": sub["bedId"], "by": "rows"} and "sharing the rows" in rw["pill"] and "1 of 2 rows" in rw["toast"] and all("1 of 2 rows" in m for m in rw["mates"]) and rw["settle"] == start["settle"], rw)
    drop(1)
    rows3 = js("return ask()")
    check("a third dropped while the rows are being shared cannot have a row: the question comes back, offering only to replace", bool(rows3) and [w[0] for w in rows3["ways"]] == ["replace"], rows3)
    page.keyboard.press("Escape"); wait(200)
    page.evaluate("LRFApp.undo()"); wait(300)
    check("undone, the plan is as it was", js("return A.contentKey()") == key0)

    # ══ replace ══
    page.evaluate("LRFApp.endMixing()")
    drop(0); click("#shareAsk [data-way=replace]", 600)
    rp = js("return { list: inBed(arg.bedId), waiting: A.waiting().map(w => ({ id: w.id, date: w.date, variety: w.varietyId, bed: w.bedId || null, from: w.wait && w.wait.from, why: w.wait && w.wait.why })), undo: S.undo.length, toast: txt('toast'), mixing: A.mixing(), badge: $('waitBadge').hidden ? '' : txt('waitBadge'), n: S.plan.plantings.length, label: S.undo[S.undo.length - 1].label }", sub)
    mine = [x for x in rp["waiting"] if x["id"] == sub["id"]]
    check("“Replace”: the newcomer has the whole bed and the crop that was there has left it, in one step, with no mixing begun", len(rp["list"]) == 1 and rp["list"][0]["id"] != sub["id"] and abs(rp["list"][0]["len"] - sub["cap"]) < 1e-6 and rp["undo"] == 1 and rp["mixing"] is None and rp["n"] == start["n"] and rp["label"].startswith("Replace "), rp)
    check("it is not removed: it waits under To place, itself, with its date and its variety, and the header counts it", len(mine) == 1 and mine[0]["date"] == sub["pdate"] and mine[0]["bed"] is None and mine[0]["from"] == sub["bedId"] and len(rp["waiting"]) == start["waiting"] + 1 and "to place" in rp["badge"] and "waits under To place" in rp["toast"] and "worth" in rp["toast"], rp)
    js("A.select({ type: 'waiting', id: arg.id })", sub); wait(400)
    why = js("return txt('wtWhy')")
    check("its own panel says why it waits and that it keeps its date", "took its bed" in why and sub["bed"] in why and "keeps its date" in why, why)
    shot("replaced")
    page.evaluate("LRFApp.select(null)"); page.evaluate("LRFApp.undo()"); wait(300)
    check("one Undo puts it back in its bed, where it stood in the plan", js("return { key: A.contentKey(), order: S.plan.plantings.map(p => p.id).join(',') }") == {"key": key0, "order": order0})

    # ══ a bed that is booked twice is not called a shared bed ══
    twice = js("""const todo = R.cleanup(eng); for (const g of todo.groups) { const m = R.mates(eng, g.late), res = R.equalize(eng, m.map(x => x.p.id)); if (res.ops && res.ops.length && m.length === 2) return { id: g.late.id, bedId: g.late.bedId, cap: eng.capOf(eng.bedOf(g.late.bedId)), n: m.length, groups: todo.groups.length, field: E.d2s(eng.calc(g.late).field) }; } return null;""")
    check("the plan has ground booked twice by two plantings, to try", bool(twice), twice)
    if twice:
        js("A.setDate(E.s2d(arg.field)); A.select({ type: 'planting', id: arg.id })", twice); wait(400)
        said2 = js("const f = $('fMatesField'); return f ? { twice: f.dataset.twice || '', label: f.querySelector('span').textContent, button: txt('fEqual'), rows: document.querySelectorAll('#fMates li').length, text: f.textContent } : null")
        check("its panel says the two are booked into the same ground, not that they share a bed, and offers to share it between them as one way to settle it", bool(said2) and said2["twice"] == "1" and said2["label"].startswith("Booked into the same ground in") and "Shares" not in said2["label"] and said2["button"] == "Share the bed between them" and "To settle" in said2["text"] and said2["rows"] == twice["n"], said2)
        click("#fEqual", 600)
        shared = js("return { list: inBed(arg.bedId).filter(x => true), groups: R.cleanup(eng).groups.length, toast: txt('toast'), undo: S.undo.length, label: (document.querySelector('#fMatesField span') || {}).textContent, twice: ($('fMatesField') || { dataset: {} }).dataset.twice || '' }", twice)
        check("pressed, the two take half the bed each, that ground is no longer booked twice, and it says so with the season's worth", shared["groups"] == twice["groups"] - 1 and "no longer booked twice" in shared["toast"] and "worth" in shared["toast"] and shared["undo"] == 1 and shared["twice"] == "" and shared["label"].startswith("Shares "), shared)
        page.evaluate("LRFApp.undo()"); wait(300)
        check("one Undo books it twice again, as it was", js("return { key: A.contentKey(), groups: R.cleanup(eng).groups.length }") == {"key": key0, "groups": twice["groups"]})
    js("A.setDate(E.s2d(arg.date)); A.select(null)", sub); wait(300)

    # ══ what is not asked ══
    rec = js("const p = eng.planting(arg.id); A.commit('A check: record it as planted', [{ before: p, after: { ...p, done: { field: p.date } } }], { unchecked: true }); const a = A.preview({ cropId: arg.cropId, varietyId: arg.others[0] }, { bedId: arg.bedId, date: S.date }); A.place({ cropId: arg.cropId, varietyId: arg.others[0] }, arg.bedId, S.date, {}); return { state: a.state, text: a.text, ask: !!$('shareAsk'), toast: txt('toast'), n: inBed(arg.bedId).length };", sub)
    check("a bed held by a planting already recorded as planted is not split and not replaced: the drop is refused in words, with no question", rec["state"] == "blocked" and "already recorded" in rec["text"] and not rec["ask"] and "already recorded" in rec["toast"] and rec["n"] == 1, rec)
    page.evaluate("LRFApp.undo()"); wait(200)
    swap = js("""const soil = S.plan.beds.filter(b => eng.isSoilBed(b) && b.active !== false); let tried = 0;
      for (const p of S.plan.plantings) { const r = eng.calc(p); if (!r || !eng.isSoilBed(r.b) || r.partial || p.bedLayout) continue;
        for (const b of soil) { if (b.id === p.bedId || b.gardenId !== r.b.gardenId) continue; if (++tried > 1500) return { tried }; const a = A.preview({ plantingId: p.id }, { bedId: b.id, date: E.s2d(p.date) }); if (a.state === 'swap') return { state: a.state, text: a.text, tried }; } }
      return { tried };""")
    check("a planting dragged onto ground it can trade places with still trades, as before: the question is for what cannot", swap.get("state") == "swap" and "Trade places" in swap.get("text", ""), swap)
    js("A.setView('timeline'); A.place({ cropId: arg.cropId, varietyId: arg.others[0] }, arg.bedId, S.date, {});", sub); wait(500)
    tl = js("return { ask: ask(), toast: txt('toast'), undo: S.undo.length }")
    check("dropped on that bed's row in the Timeline, no question is asked: the row is held and the drop is refused in words (0.38: the question is for the library on the map)", not tl["ask"] and ("eld by" in tl["toast"] or "esting" in tl["toast"]), tl)
    page.keyboard.press("Escape"); wait(200)
    js("A.setView('map')"); wait(400)
    check("after all of it the plan is the one he started from", js("return { key: A.contentKey(), undo: S.undo.length }")["key"] == key0)

    # ══ the farm photo, when a plan arrives with variety photos and none of the farm ══
    ph0 = js("return { gap: A.photoGaps().map, href: ($('mapPhoto').getAttribute('href') || '').slice(0, 5), note: !!(S.plan.lrfNext && S.plan.lrfNext.mapImage) }")
    check("the farm photo is on the map", not ph0["gap"] and len(ph0["href"]) > 0, ph0)
    came = page.evaluate("""async () => { const A = LRFApp, plan = { ...A.state.plan }; delete plan.lrfNext;
      const ok = await A.importBackup(new File([JSON.stringify(plan)], 'the cloud', { type: 'application/json' }), { exact: true, asked: true, quiet: true, thumbs: JSON.stringify(LRFThumbs.all()) });
      await new Promise(r => setTimeout(r, 700));
      return { ok: !!ok, gap: A.photoGaps().map, href: (document.getElementById('mapPhoto').getAttribute('href') || '').slice(0, 5), note: !!(A.state.plan.lrfNext && A.state.plan.lrfNext.mapImage), n: A.state.plan.plantings.length }; }""")
    check("a plan opened the way the cloud hands it over, with variety photos and no farm photo, leaves the farm photo where it is", came["ok"] and not came["gap"] and came["href"] == ph0["href"] and came["note"] == ph0["note"] and came["n"] == start["n"], {"before": ph0, "after": came})
    if ph0["note"]:
        # a browser that has already lost its note of the photo, with the photo's bytes still kept: the note is written again on the next load
        page.evaluate("""async () => { const A = LRFApp, S = A.state; delete S.plan.lrfNext.mapImage; const p = S.plan.plantings[0]; A.commit('A check: touch the plan', [{ before: p, after: { ...p, notes: (p.notes || '') + ' ' } }], { unchecked: true }); A.undo(); await new Promise(r => setTimeout(r, 2500)); }""")
        page.reload(); ready(); page.wait_for_timeout(1500)
        healed = page.evaluate("({ gap: LRFApp.photoGaps().map, href: (document.getElementById('mapPhoto').getAttribute('href') || '').slice(0, 5), note: !!(LRFApp.state.plan.lrfNext && LRFApp.state.plan.lrfNext.mapImage), n: LRFApp.state.plan.plantings.length })")
        check("a browser that lost its note of the photo and still holds the photo puts it back by itself on the next load", not healed["gap"] and healed["href"] == "blob:" and healed["note"] and healed["n"] == start["n"], healed)
        page.reload(); ready(); page.wait_for_timeout(800)
        check("and it is still there after one more load", page.evaluate("!LRFApp.photoGaps().map && !!(LRFApp.state.plan.lrfNext && LRFApp.state.plan.lrfNext.mapImage)"))
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
