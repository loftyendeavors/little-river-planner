"""Preview 0.38 in a real browser: the question "split the length, split the rows, or replace" is asked only of a crop or a
variety brought from the library onto the map. A planting that is moved, on the map or on the timeline, is never asked: it trades
places where it can and is otherwise refused, and nothing is planted. A crop from the library dropped on a held row of the
timeline is refused too. His words, 2026-11-13: "it should only try to do that behavior if something is dragged from the library
on the map page".
usage: python3 -I ask_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280")); DARK = os.environ.get("DARK") == "1"; STOP = os.environ.get("STOP_AT_FAIL") == "1"
LABEL = "0.39"
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, R = LRFRails, $ = id => document.getElementById(id), eng = S.engine, txt = id => ($(id) || {}).textContent || '';"
       "const soil = S.plan.beds.filter(b => eng.isSoilBed(b) && b.active !== false);"
       "const free = p => { const r = eng.calc(p); return !!r && eng.isSoilBed(r.b) && !r.partial && !p.bedLayout && !(p.ft > 0) && !R.fixed(eng, { p }); };")
# every planting that is free to move, tried on every other soil bed on its own date: what the drop would do, counted by state
TALLY = """const out = { ok: 0, partial: 0, swap: 0, blocked: 0, split: 0, held: 0, tried: 0 }; let n = 0;
  for (const p of S.plan.plantings) { if (!free(p)) continue; if (++n > 60) break;
    for (const b of soil) { if (b.id === p.bedId) continue; const a = A.preview(arg.library ? { cropId: p.cropId, varietyId: p.varietyId || undefined } : { plantingId: p.id, copy: arg.copy || undefined }, { bedId: b.id, date: E.s2d(p.date), survey: arg.survey || undefined });
      out.tried++; out[a.state] = (out[a.state] || 0) + 1; if (a.why === 'held' || a.state === 'split' || a.state === 'swap') out.held++; } }
  return out;"""
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
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    key0 = js("return A.contentKey()")
    start = js("return { n: S.plan.plantings.length, undo: S.undo.length, label: txt('buildNote'), view: S.view, fn: typeof A.asksToShare }")
    check(f"a plan is open on the map with nothing to undo; the build says {LABEL}", start["n"] > 300 and start["undo"] == 0 and LABEL in start["label"] and start["view"] == "map", start)

    # ══ who is asked, said by the planner itself ══
    who = js("""if (typeof A.asksToShare !== 'function') return { map: null, timeline: {}, harvest: {} }; const on = v => { A.setView(v); return { lib: A.asksToShare({ cropId: 'x' }), variety: A.asksToShare({ cropId: 'x', varietyId: 'y' }), moved: A.asksToShare({ plantingId: 'p' }), copied: A.asksToShare({ plantingId: 'p', copy: true }), waiting: A.asksToShare({ waitingId: 'w' }) }; };
      const map = on('map'), timeline = on('timeline'), harvest = on('harvest'); A.setView('map'); return { map, timeline, harvest };""")
    check("on the map a crop or a variety from the library is asked; a planting moved or copied, and one that waits, are not", who["map"] == {"lib": True, "variety": True, "moved": False, "copied": False, "waiting": False}, who)
    check("on the timeline, and in any other view, nobody is asked", bool(who["map"]) and all(not v for v in who["timeline"].values()) and all(not v for v in who["harvest"].values()), who)
    wait(300)

    # ══ the map: the library asks, a moved planting never does ══
    lib_map = js(TALLY, {"library": True})
    check("on the map, a crop from the library over ground that is held is asked to split or replace", lib_map["split"] > 0 and lib_map["tried"] > 500, lib_map)
    mv_map = js(TALLY, {})
    check("on the map, a planting moved onto ground that is held is never asked: of every bed tried, none answers with the question", mv_map["split"] == 0 and mv_map["held"] > 50 and mv_map["tried"] == lib_map["tried"], mv_map)
    check("it trades places where it can, as before, and is refused where it cannot", mv_map["swap"] > 0 and mv_map["blocked"] > 0, mv_map)
    cp_map = js(TALLY, {"copy": True})
    check("a planting copied with Alt is not asked either", cp_map["split"] == 0 and cp_map["held"] > 50, cp_map)
    sv_map = js(TALLY, {"survey": True})
    check("while a planting is in the air, no bed on the map is drawn as one that would ask", sv_map["split"] == 0 and sv_map["held"] > 50, sv_map)
    sv_lib = js(TALLY, {"library": True, "survey": True})
    check("while a crop from the library is in the air, the beds that would ask are still drawn so", sv_lib["split"] > 0, sv_lib)

    # one planting that cannot trade, dropped on a held bed of the map through the planner's own drop
    stuck = js("""for (const p of S.plan.plantings) { if (!free(p)) continue;
        for (const b of soil) { if (b.id === p.bedId) continue; const t = { bedId: b.id, date: E.s2d(p.date) }; const a = A.preview({ plantingId: p.id }, t);
          if (a.state !== 'blocked' || a.why !== 'held') continue; const sh = R.share(eng, { plantingId: p.id }, t); if (!sh || !(sh.length || sh.rows || sh.replace)) continue;
          return { id: p.id, from: p.bedId, to: b.id, date: p.date, text: a.text, crop: p.cropId, variety: p.varietyId || null }; } } return null;""")
    check("the plan has a planting that could share another bed and cannot trade places with what holds it, to try", bool(stuck), stuck)
    if stuck:
        dropped = js("A.setDate(E.s2d(arg.date)); const r = A.place({ plantingId: arg.id }, arg.to, E.s2d(arg.date), {}); return { r: !!r, ask: !!$('shareAsk'), bed: eng.planting(arg.id).bedId, toast: txt('toast'), undo: S.undo.length, key: A.contentKey(), mixing: !!A.mixing() };", stuck)
        check("dropped there on the map it is refused in words: no question, nothing moved, nothing to undo", not dropped["r"] and not dropped["ask"] and dropped["bed"] == stuck["from"] and dropped["undo"] == 0 and dropped["key"] == key0 and not dropped["mixing"] and ("eld by" in dropped["toast"] or "esting" in dropped["toast"]), dropped)
        check("the words are the ones a held bed has always had, with no offer to split or replace", "split" not in stuck["text"] and "replace" not in stuck["text"] and ("Held by" in stuck["text"] or "Resting" in stuck["text"]), stuck)
        # the same bed, the same day, a crop from the library: asked
        asked = js("A.place({ cropId: arg.crop, varietyId: arg.variety || undefined }, arg.to, E.s2d(arg.date), {}); const el = $('shareAsk'); return { ask: !!el, ways: el ? [...el.querySelectorAll('.fix-btn')].map(b => b.dataset.way) : [], undo: S.undo.length, key: A.contentKey() };", stuck); wait(300)
        check("the same bed on the same day, with that crop brought from the library: the question is asked, and nothing is planted until it is answered", asked["ask"] and len(asked["ways"]) >= 1 and asked["undo"] == 0 and asked["key"] == key0, asked)
        shot("asked-on-the-map")
        page.keyboard.press("Escape"); wait(250)
        check("Escape leaves it without planting", js("return { ask: !!$('shareAsk'), key: A.contentKey(), undo: S.undo.length }") == {"ask": False, "key": key0, "undo": 0})

    # ══ a bed that is being mixed: the library splits it again, a planting from elsewhere does not ══
    # a bed is split through the planner's own function, what could trade into it is counted, and it is undone: the first bed with both kinds of mover is the one tried
    mix = js("""let tries = 0; const freeNow = p => { const e = S.engine, r = e.calc(p); return !!r && e.isSoilBed(r.b) && !r.partial && !p.bedLayout && !(p.ft > 0) && !R.fixed(e, { p }); };
      for (const b of soil) { if (!(eng.capOf(b) >= 30)) continue; for (const p of eng.plantingsIn(b.id)) { if (!free(p) || !p.varietyId) continue; const others = eng.varietiesOf(p.cropId).map(v => v.id).filter(id => id !== p.varietyId); if (others.length < 2) continue;
          const t = { bedId: b.id, date: E.s2d(p.date) }, pay = { cropId: p.cropId, varietyId: others[0] }, sh = R.share(eng, pay, t); if (!sh || !sh.length) continue; if (++tries > 14) return null;
          A.setDate(E.s2d(p.date)); if (!A.applyShare(pay, sh, 'length')) continue; const e2 = S.engine; let trader = null, mover = null;
          for (const q of S.plan.plantings) { if (q.bedId === b.id || !freeNow(q)) continue; const tt = { bedId: b.id, date: E.s2d(q.date) }; if (R.swap(e2, { plantingId: q.id }, tt)) trader = trader || q; else if (!mover && R.propose(e2, { plantingId: q.id }, tt).why === 'held') mover = q; if (trader && mover) break; }
          A.endMixing(); A.undo();
          if (trader && mover) return { bedId: b.id, id: p.id, date: p.date, crop: p.cropId, others, mover: mover.id, moverDate: mover.date, moverBed: mover.bedId, trader: trader.id, traderDate: trader.date, tries }; break; } } return null;""")
    wait(300)
    check("probing for it left the plan as it was", js("return { key: A.contentKey(), mixing: !!A.mixing() }") == {"key": key0, "mixing": False})
    page.evaluate("LRFApp.state.undo.length = 0; LRFApp.state.redo && (LRFApp.state.redo.length = 0)")
    check("the plan has a bed to mix, a planting elsewhere that cannot trade into it and one that can, to try", bool(mix), mix)
    if mix:
        js("A.setDate(E.s2d(arg.date)); A.place({ cropId: arg.crop, varietyId: arg.others[0] }, arg.bedId, E.s2d(arg.date), {});", mix); wait(300)
        opened = page.locator("#shareAsk [data-way=length]").count() > 0
        if opened: page.locator("#shareAsk [data-way=length]").click(); wait(500)
        m1 = js("return { mixing: A.mixing(), n: eng.plantingsIn(arg.bedId).length, undo: S.undo.length }", mix)
        check("a variety from the library splits the bed and the bed is being mixed", opened and bool(m1["mixing"]) and m1["mixing"]["bedId"] == mix["bedId"] and m1["undo"] == 1, m1)
        again = js("const a = A.preview({ cropId: arg.crop, varietyId: arg.others[1] }, { bedId: arg.bedId, date: E.s2d(arg.date) }); return { state: a.state, text: a.text };", mix)
        check("the next variety from the library splits it again without asking", again["state"] == "split" and "Splits again" in again["text"], again)
        moved = js("const a = A.preview({ plantingId: arg.mover }, { bedId: arg.bedId, date: E.s2d(arg.moverDate) }); const n = eng.plantingsIn(arg.bedId).length; A.place({ plantingId: arg.mover }, arg.bedId, E.s2d(arg.moverDate), {}); return { state: a.state, text: a.text, ask: !!$('shareAsk'), n0: n, n: S.engine.plantingsIn(arg.bedId).length, bed: S.engine.planting(arg.mover).bedId, undo: S.undo.length };", mix)
        check("a planting dragged in from another bed does not split the bed being mixed: it is refused, and stays where it was", moved["state"] != "split" and "Splits" not in moved["text"] and not moved["ask"] and moved["n"] == moved["n0"] and moved["bed"] == mix["moverBed"] and moved["undo"] == 1, moved)
        trade = js("const t = { bedId: arg.bedId, date: E.s2d(arg.traderDate) }, a = A.preview({ plantingId: arg.trader }, t); return { state: a.state, text: a.text, rails: !!R.swap(eng, { plantingId: arg.trader }, t) };", mix)
        check("and one that can trade places with what stands in the bed being mixed is offered the trade, as on any other bed", trade["rails"] and trade["state"] == "swap" and "Trade places" in trade["text"], trade)
        page.evaluate("LRFApp.endMixing(); LRFApp.undo()"); wait(300)
        check("one Undo, and the plan is the one he started from", js("return A.contentKey()") == key0)

    # ══ the timeline: nobody is asked ══
    js("A.select(null); A.setView('timeline')"); wait(700)
    lib_tl = js(TALLY, {"library": True})
    check("on the timeline, a crop from the library over a row that is held is refused, not asked", lib_tl["split"] == 0 and lib_tl["held"] > 50 and lib_tl["blocked"] >= lib_map["split"], lib_tl)
    mv_tl = js(TALLY, {})
    check("on the timeline, a planting moved onto a row that is held is never asked", mv_tl["split"] == 0 and mv_tl["held"] > 50, mv_tl)
    check("on the timeline it trades places exactly where it does on the map", mv_tl["swap"] == mv_map["swap"] and mv_tl["blocked"] == mv_map["blocked"] and mv_tl["ok"] == mv_map["ok"], {"timeline": mv_tl, "map": mv_map})
    if stuck:
        tl_lib = js("const a = A.preview({ cropId: arg.crop, varietyId: arg.variety || undefined }, { bedId: arg.to, date: E.s2d(arg.date) }); A.place({ cropId: arg.crop, varietyId: arg.variety || undefined }, arg.to, E.s2d(arg.date), {}); return { state: a.state, text: a.text, ask: !!$('shareAsk'), toast: txt('toast'), undo: S.undo.length, key: A.contentKey() };", stuck); wait(250)
        check("the crop that was asked on the map is refused on that bed's row of the timeline, in the words a held bed has always had", tl_lib["state"] == "blocked" and not tl_lib["ask"] and "split" not in tl_lib["text"] and tl_lib["undo"] == 0 and tl_lib["key"] == key0 and ("eld by" in tl_lib["toast"] or "esting" in tl_lib["toast"]), tl_lib)

    # two plantings of one bed, one after the other: the later bar dragged with a real mouse onto the earlier one (what he did)
    pair = js("""const out = []; for (const b of soil) { const list = eng.plantingsIn(b.id).filter(p => eng.calc(p)).map(p => ({ p, r: eng.calc(p) })).sort((x, y) => x.r.field - y.r.field);
        for (let i = 0; i + 1 < list.length; i++) { const a = list[i], c = list[i + 1]; if (R.fixed(eng, { p: c.p })) continue; if (!(+c.r.field > +eng.occupancyThrough(a.p, a.r))) continue; if ((eng.occupancyThrough(a.p, a.r) - eng.occupancyFrom(a.p, a.r)) / 864e5 < 40) continue;
          const mid = new Date((+eng.occupancyFrom(a.p, a.r) + +eng.occupancyThrough(a.p, a.r)) / 2), t = { bedId: b.id, date: mid }, v = R.propose(eng, { plantingId: c.p.id }, t);   // the guard rails' own answer, whatever the planner then makes of it
          if (v.state !== 'blocked' || v.why !== 'held') continue; const sh = R.share(eng, { plantingId: c.p.id }, t); if (!sh || !(sh.length || sh.rows || sh.replace)) continue;
          out.push({ bedId: b.id, early: a.p.id, late: c.p.id, lateDate: c.p.date }); if (out.length >= 6) return out; } } return out;""")
    check("the plan has a bed with two plantings one after the other, where the later could share the earlier one's days, to try", len(pair) > 0, pair)
    done = None
    for pr in pair:
        js("LRFTimeline.setFilter && LRFTimeline.setFilter('all'); LRFTimeline.reveal(arg.late); LRFTimeline.setScale(LRFTimeline.fit(), null, false);", pr); wait(500)
        box = js("""const q = id => document.querySelector(`.tl-bar[data-planting="${CSS.escape(id)}"]`), a = q(arg.early), c = q(arg.late); if (!a || !c) return null; c.scrollIntoView({ block: 'center' });
            const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect(); return { a: [ra.left, ra.top, ra.width, ra.height], c: [rc.left, rc.top, rc.width, rc.height], vw: innerWidth, vh: innerHeight };""", pr)
        if not box or box["a"][2] < 12 or box["c"][2] < 8 or box["c"][0] + 3 > box["vw"] or box["a"][0] < 0 or box["c"][1] < 80 or box["c"][1] + box["c"][3] > box["vh"]: continue
        wait(250)
        box = js("""const q = id => document.querySelector(`.tl-bar[data-planting="${CSS.escape(id)}"]`), ra = q(arg.early).getBoundingClientRect(), rc = q(arg.late).getBoundingClientRect(); return { a: [ra.left, ra.top, ra.width, ra.height], c: [rc.left, rc.top, rc.width, rc.height] };""", pr)
        x0, y0 = round(box["c"][0] + 3), round(box["c"][1] + box["c"][3] / 2); x1 = round(box["a"][0] + box["a"][2] / 2)
        page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0 - 8, y0, steps=3); page.mouse.move(x1, y0, steps=12); wait(250)
        air = js("const g = document.querySelector('.drag-ghost'); return g ? { state: g.dataset.state || '', hint: (g.querySelector('.drag-hint') || {}).textContent || '' } : null")
        shot("bar-onto-its-neighbour"); page.mouse.up(); wait(450)
        after = js("return { ask: !!$('shareAsk'), date: eng.planting(arg.late).date, bed: eng.planting(arg.late).bedId, undo: S.undo.length, key: A.contentKey(), toast: txt('toast') }", pr)
        if after["ask"]: page.keyboard.press("Escape"); wait(200)
        if air and air["state"] in ("ok", "partial", "swap"):
            if after["undo"]: page.evaluate("LRFApp.undo()"); wait(250)
            continue   # the pointer came down on free days: not the case being tried
        done = {"pair": pr, "air": air, "after": after}; break
    check("with a real mouse on the timeline, the later bar was dragged onto the earlier one's days", bool(done), {"pairs": len(pair)})
    if done:
        air, after = done["air"], done["after"]
        check("in the air it says the days are held, and offers no split and no replacement", bool(air) and air["state"] == "blocked" and "split" not in air["hint"] and "replace" not in air["hint"] and ("Held by" in air["hint"] or "Resting" in air["hint"]), air)
        check("let go, no question opens", not after["ask"], after)
        check("and nothing moved: the planting keeps its date and its bed, there is nothing to undo, and the plan is the one he started from", after["date"] == done["pair"]["lateDate"] and after["bed"] == done["pair"]["bedId"] and after["undo"] == 0 and after["key"] == key0, after)
        check("the toast says why, in the words a held bed has always had", "eld by" in after["toast"] or "esting" in after["toast"], after)
    js("A.select(null); A.setView('map')"); wait(400)
    end = js("return { key: A.contentKey(), undo: S.undo.length, ask: !!$('shareAsk'), mixing: !!A.mixing() }")
    check("after all of it the plan is the one he started from, with no question open and no bed being mixed", end["key"] == key0 and not end["ask"] and not end["mixing"], end)
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
