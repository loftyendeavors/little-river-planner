"""L3, part 1: the messages and small fixes (#91), in a real browser.
A planting dragged to a new day on the Timeline says how far, from what day to what day; a move on the Map says where, as before. A drop
turned down because the ground is held names the day it was judged on: the map's date for a crop from the library, its own date for a
planting. While a crop is carried the library's foot has Done, which puts it down. An end of a planting dragged along its bed says what
it did, from the feet it held to the feet it holds, and the tip under the pointer never prints "null". A planting with days of its own
says so in plain words. A click on a bare Timeline row says the date moved, with the way back. His own days typed for a crop name the
varieties that keep theirs, and offer to set them too and to see the plantings. A planting's panel puts the schedule and what it is
expected to give before its boxes. The map's key wraps to a second line before anything waits behind "+n", and the map holds still.
The unheated benches and a celled tray with no cells set are named in plain words. With nothing counted, what can wait is reached from
one quiet link on the Assumptions page.
Every subject is found on the plan the page was given, by its hooks: nothing here names a crop, a bed, a garden or a date of any plan.
usage: python3 -I messages_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1707, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1707")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
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
# What the page says is read where it says it: the answer's words and its buttons, by their hooks. Each step starts with the answer emptied,
# so that what is read is what that step said.
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, UI = LRFUI, eng = () => S.engine, sc = document.getElementById('tlScroll');"
       "const sleep = ms => new Promise(r => setTimeout(r, ms));"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const hush = () => { const t = hook('toast'); if (t) t.replaceChildren(); };"
       "const said = () => { const t = hook('toast'), s = t && t.querySelector('span'); return s ? s.textContent : ''; };"
       "const offers = () => hooks('toast-action').map(b => b.textContent);"
       "const press = label => { const b = hooks('toast-action').find(x => x.textContent === label); if (b) b.click(); return !!b; };"
       "const apply = async () => { await sleep(150); const d = document.querySelector('dialog[open]'); if (d && d.querySelector('.btn.primary')) { d.querySelector('.btn.primary').click(); await sleep(250); } };"
       "const fieldOf = id => { const p = eng().planting(id), r = p && eng().calc(p); return r ? +r.field : null; };"
       "const lenOf = id => { const p = eng().planting(id), r = p && eng().calc(p), f = r && eng().footprint(p, r); return f ? Math.round((Math.min(f.a1, r.cap) - f.a0) * 10) / 10 : null; };")
def run_js(page, body, arg=None):
    return page.evaluate("async (arg) => { %s %s }" % (PRE, body), arg)

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 960})
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    js = lambda body, arg=None: run_js(page, body, arg)
    wait = page.wait_for_timeout
    def open_page():
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
        if backup and page.evaluate("LRFApp.isSample()"):
            page.set_input_files("#importFile", backup); wait(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); wait(1500)
    open_page()
    page.evaluate("try { localStorage.removeItem('lrf.tryCard'); } catch (_) {}")
    open_page()
    js("A.state.undo.length = 0; A.state.redo.length = 0; return 1;")

    # ══ 1. a planting dragged four days later on the Timeline ══
    # the subject: a planting in a soil bed that four days later still fits where it is, drawn as a bar of its own
    sub = js("""const out = [];
      for (const p of S.plan.plantings) { const r = eng().calc(p); if (!r || !eng().isSoilBed(r.b) || p.done) continue;
        const res = A.preview({ plantingId: p.id }, { bedId: p.bedId, date: E.addDays(r.field, 4) }); if (res.state !== 'ok') continue;
        out.push({ id: p.id, bed: p.bedId, label: A.cropLabel(p), where: A.bedLabel(r.b), field: +r.field }); if (out.length > 40) break; }
      A.setView('timeline'); await sleep(700); document.querySelector('[data-tl-zoom="days"]').click(); await sleep(500);
      for (const x of out) { A.setDate(new Date(x.field)); await sleep(60); const bar = document.querySelector('#tlBody [data-hook="tl-planting"][data-planting="' + CSS.escape(x.id) + '"]'); if (!bar) continue;
        const v = sc.getBoundingClientRect(), b0 = bar.getBoundingClientRect(); sc.scrollTop += b0.top - (v.top + 160); sc.scrollLeft += b0.left - (v.left + 400); await sleep(150);
        const b = bar.getBoundingClientRect(), lane = bar.parentElement.getBoundingClientRect(), ppd = LRFTimeline.scale();
        const k = Math.ceil((b.left - lane.left) / ppd) + 0.5, x0 = Math.round(lane.left + k * ppd);
        if (b.width < ppd * 2 || b.left < v.left + 160 || x0 + 6 * ppd > v.right || b.top < v.top + 60 || b.bottom > v.bottom - 20) continue;
        return { ...x, x0, x1: Math.round(lane.left + (k + 4) * ppd), y: Math.round(b.top + b.height / 2) }; }
      return null;""")
    check("the plan has a planting that fits four days later in its own bed, drawn as a bar on the Timeline, for the check to drag", bool(sub), sub)
    if sub:
        js("hush(); return 1;")
        page.mouse.move(sub["x0"], sub["y"]); page.mouse.down(); page.mouse.move(sub["x0"] + 8, sub["y"], steps=3); page.mouse.move(sub["x1"], sub["y"], steps=8); page.mouse.up(); wait(400)
        drag = js("""const now = fieldOf(arg.id), was = new Date(arg.field); return { now, moved: now == null ? null : E.dayDiff(new Date(now), was), said: said(), offers: offers(),
          want: UI.day(was) + ' → ' + (now == null ? '' : UI.day(new Date(now))) };""", sub)
        check("dragged four days later on the Timeline, the planting goes in four days later in the same bed", drag["moved"] == 4, drag)
        check("and the answer says how far, from what day to what day: “4 days later, <was> → <now>”, with the planting and its bed", drag["moved"] == 4 and ("4 days later, " + drag["want"]) in drag["said"] and sub["label"] in drag["said"] and sub["where"] in drag["said"], drag)
        check("with Undo as its one action", drag["offers"] == ["Undo"], drag)
        back = js("press('Undo'); await sleep(300); return { field: fieldOf(arg.id), was: arg.field };", sub)
        check("Undo puts the planting back on its day", back["field"] == back["was"], back)

    # ══ 2. a move on the map keeps its date, and says where, as before ══
    mv = js("""A.setView('map'); await sleep(500); hush();
      for (const p of S.plan.plantings) { const r = eng().calc(p); if (!r || !eng().isSoilBed(r.b)) continue;
        for (const b of S.plan.beds) { if (b.id === p.bedId || b.active === false || !eng().isSoilBed(b)) continue;
          const res = A.preview({ plantingId: p.id }, { bedId: b.id, date: E.s2d(p.date) }); if (res.state !== 'ok') continue;
          A.place({ plantingId: p.id }, b.id, E.s2d(p.date)); await sleep(200);
          const out = { said: said(), where: A.bedLabel(b), field: fieldOf(p.id), was: +r.field }; press('Undo'); await sleep(200); return out; } }
      return null;""")
    check("a planting moved to another bed on the Map keeps its day, and the answer says where it went and on what day, with no days counted", bool(mv) and mv["field"] == mv["was"] and ("→ " + mv["where"]) in mv["said"] and "later" not in mv["said"] and "earlier" not in mv["said"], mv)

    # ══ 3. a drop turned down because the ground is held names the day it was judged on ══
    held = js("""A.setView('map'); await sleep(300); const out = {};
      A.setDate(new Date(A.planYear(), 5, 15)); await sleep(200);
      // a crop from the library on a space held on the map's date that cannot be shared (a tower or a group of containers)
      for (const b of S.plan.beds) { if (b.active === false || eng().isSoilBed(b) || eng().isRack(b) || eng().isPool(b)) continue;
        for (const c of eng().crops()) { if (!LRFSuccession.suits(eng(), c, b)) continue; const res = A.preview({ cropId: c.id }, { bedId: b.id, date: S.date }); if (res.state !== 'blocked' || res.why !== 'held') continue;
          hush(); A.place({ cropId: c.id }, b.id, S.date); await sleep(150); out.crop = { said: said(), day: UI.day(S.date), where: A.bedLabel(b) }; break; }
        if (out.crop) break; }
      // a planting dragged onto a soil bed held on its own day, with no trade to make
      for (const p of S.plan.plantings) { const r = eng().calc(p); if (!r || !eng().isSoilBed(r.b) || +E.s2d(p.date) === +S.date) continue;
        for (const b of S.plan.beds) { if (b.id === p.bedId || b.active === false || !eng().isSoilBed(b)) continue;
          const res = A.preview({ plantingId: p.id }, { bedId: b.id, date: E.s2d(p.date) }); if (res.state !== 'blocked' || res.why !== 'held') continue;
          hush(); A.place({ plantingId: p.id }, b.id, E.s2d(p.date)); await sleep(150); out.moved = { said: said(), day: UI.day(E.s2d(p.date)), where: A.bedLabel(b), stays: eng().planting(p.id).bedId === p.bedId }; break; }
        if (out.moved) break; }
      out.undo = S.undo.length; return out;""")
    c, m = held.get("crop") or {}, held.get("moved") or {}
    check("a crop from the library turned down on the map because the space is held says so, and names the map's date it was judged on", bool(c) and c["said"].startswith(c["where"] + ": held") and c["said"].endswith("judged on " + c["day"] + ", the map’s date"), held)
    check("a planting dragged onto held ground on the map is turned down, stays where it was, and the answer names its own date", bool(m) and m["stays"] and m["said"].startswith(m["where"] + ": ") and m["said"].endswith("judged on its own date, " + m["day"]), held)
    check("a drop turned down changes nothing", held.get("undo") == 0, held)

    # ══ 4. Done at the foot of the library ══
    lib = js("""A.setView('map'); await sleep(300); const c = eng().crops().find(x => !x.micro);
      const before = { done: drawn(hook('lib-done')), hint: hook('lib-hint').textContent };
      A.arm({ cropId: c.id }); await sleep(250);
      const armed = { done: drawn(hook('lib-done')), text: hook('lib-done') && hook('lib-done').textContent, hint: hook('lib-hint').textContent };
      A.setView('timeline'); await sleep(400); const onTl = { done: drawn(hook('lib-done')), hint: hook('lib-hint').textContent };
      A.setView('map'); await sleep(300);
      hook('lib-done').click(); await sleep(250);
      return { before, armed, onTl, after: { armed: S.armed, done: drawn(hook('lib-done')), hint: hook('lib-hint').textContent } };""")
    check("with no crop carried the library's foot says “Drag a crop onto a bed. Or click it, then click beds.”, with no Done", lib["before"]["done"] is False and lib["before"]["hint"] == "Drag a crop onto a bed. Or click it, then click beds.", lib)
    check("while a crop is carried, Done stands at the foot of the library, on the Map and on the Timeline", lib["armed"]["done"] is True and lib["armed"]["text"] == "Done" and lib["onTl"]["done"] is True and "Esc" not in lib["armed"]["hint"], lib)
    check("Done puts the crop down, and goes", lib["after"]["armed"] is None and lib["after"]["done"] is False and lib["after"]["hint"] == lib["before"]["hint"], lib)

    # ══ 5. a resize says what it did, once: in the planting's panel, or on its card with the card on; the tip prints no "null" ══
    fmt = lambda n: ("%d" % n) if abs(n - round(n)) < 1e-9 else ("%.1f" % n)
    def resize(where):
        rs = js("""A.setView('map'); await sleep(300); A.select(null); A.setDate(new Date(A.planYear(), 5, 15)); await sleep(400); hush();
          const m = document.getElementById('map').getBoundingClientRect();
          for (const p of S.plan.plantings) { const r = eng().calc(p); if (!r || !eng().isSoilBed(r.b) || r.layout || p.done) continue; const f = eng().footprint(p, r);
            if (!f || f.x0 > 0.001 || f.x1 < 0.999 || Math.min(f.a1, r.cap) - f.a0 < 8 || !(+r.field <= +S.date && +S.date <= +eng().occupancyThrough(p, r))) continue;
            const el = document.querySelector('#mapBeds [data-planting="' + CSS.escape(p.id) + '"]'); if (!el) continue; const b = el.getBoundingClientRect();
            if (b.left < m.left + 80 || b.right > m.right - 80 || b.top < m.top + 80 || b.bottom > m.bottom - 120) continue;
            return { id: p.id, x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), len: lenOf(p.id), cap: r.cap }; }
          return null;""")
        check("the plan has a planting standing in part of a bed on the map, for the check to drag its end (%s)" % where, bool(rs), rs)
        if not rs: return
        page.mouse.move(rs["x"], rs["y"])
        for _ in range(7): page.mouse.wheel(0, -300); wait(70)
        wait(400)
        grip = js("""A.select({ type: 'planting', id: arg.id }); await sleep(600); const g = hooks('planting-end').find(x => x.getAttribute('data-handle') === 'end') || hooks('planting-end')[0];
          const fill = document.querySelector('#mapBeds [data-planting="' + CSS.escape(arg.id) + '"]');
          if (!g || !fill) return null; const b = g.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), h: fill.getBoundingClientRect().height, edge: g.getAttribute('data-handle'), card: drawn(hook('card')) };""", rs)
        check("a planting picked on the map, drawn large enough, has its ends to drag (%s)" % where, bool(grip) and grip["card"] == (where == "card"), grip)
        if not grip: return
        js("hush(); return 1;")
        dy = max(12, round(grip["h"] * 0.3)) * (1 if grip["edge"] == "end" else -1)
        page.mouse.move(grip["x"], grip["y"]); page.mouse.down(); page.mouse.move(grip["x"], grip["y"] + dy / 2, steps=3); page.mouse.move(grip["x"], grip["y"] + dy, steps=5)
        tip = js("const t = hook('map-tip'); return t ? { shown: drawn(t), text: t.textContent } : null;")
        page.mouse.up(); wait(500)
        after = js("""const line = arg.where === 'card' ? hook('card-said') : hook('panel-saved');
          return { len: lenOf(arg.id), toast: said(), line: line ? line.textContent : null, undo: !!line && !!line.querySelector(arg.where === 'card' ? '[data-hook="card-undo"]' : '[data-hook="panel-saved-undo"]') };""", {**rs, "where": where})
        if where == "panel":
            check("while an end is dragged, the tip says the length and the plants, and never “null”", bool(tip) and tip["shown"] and "ft" in tip["text"] and "null" not in tip["text"], tip)
        want = after["len"] is not None and "Resize " in (after["line"] or "") and ("%s → %s ft" % (fmt(rs["len"]), fmt(after["len"]))) in (after["line"] or "")
        check("an end dragged on the map changes the planting's length, and the planting's %s says what it did, from the feet it held to the feet it holds, with Undo" % ("card" if where == "card" else "panel"), after["len"] != rs["len"] and want and after["undo"], {"after": after, "was": rs["len"]})
        check("and that is the one answer: nothing else says it (%s)" % where, after["toast"] == "", after)
        back = js("""const b = arg.where === 'card' ? document.querySelector('[data-hook="card-said"] [data-hook="card-undo"]') : hook('panel-saved-undo'); if (b) b.click(); await sleep(400); return lenOf(arg.id);""", {**rs, "where": where})
        check("its Undo gives the planting its length back (%s)" % where, back == rs["len"], {"back": back, "was": rs["len"]})
        js("A.select(null); LRFMap.fit(); return 1;"); wait(300)
    resize("panel")

    # ══ 6. a planting with days of its own says so plainly ══
    own = js("""for (const p of S.plan.plantings) { if (!eng().pinned(p)) continue; const r = eng().calc(p); if (!r || eng().isPool(r.b) || (r.c.catalogTiming || {}).activeMode === 'catalog') continue;
        A.select({ type: 'planting', id: p.id }); await sleep(350); const el = document.querySelector('.inspector [data-hook="dtm-said"]'); const out = { text: el ? el.textContent : null, pinned: document.querySelector('.inspector').textContent.includes('Pinned') }; A.select(null); await sleep(100); return out; }
      return null;""")
    check("a planting that carries its own days says “Its own days. Empty the box to follow your list.”, and “Pinned” is gone", bool(own) and own["text"] == "Its own days. Empty the box to follow your list." and own["pinned"] is False, own)

    # ══ 7. a planting's panel: the schedule and what it gives first, the boxes after ══
    order = js("""const p = S.plan.plantings.find(x => { const r = eng().calc(x); return r && eng().isSoilBed(r.b) && eng().yieldOf(x, r); }); A.select({ type: 'planting', id: p.id }); await sleep(350);
      const panel = document.querySelector('.inspector'), sched = panel.querySelector('[data-hook="panel-schedule"]'), date = panel.querySelector('#fDate'), dtm = panel.querySelector('#fDtm'), yl = panel.querySelector('#fYieldLine');
      const before = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const out = { sched: !!sched, first: before(sched, date) && before(sched, dtm), yieldIn: !!yl && !!sched && sched.contains(yl), jobs: !!sched && !!sched.querySelector('#jobList') };
      A.select(null); await sleep(100); return out;""")
    check("in a planting's panel the schedule comes before its boxes (the date, the days to harvest)", order["sched"] and order["jobs"] and order["first"], order)
    check("and what it is expected to give stands with the schedule, before the boxes", order["yieldIn"], order)

    # ══ 8. a click on a bare Timeline row says the date moved, with the way back ══
    bare = js("""A.select(null); A.setView('timeline'); await sleep(500); document.querySelector('[data-tl-zoom="months"]').click(); await sleep(400);
      A.setDate(new Date(A.planYear(), 4, 1)); await sleep(200); sc.scrollTop = 0; await sleep(150);
      const v = sc.getBoundingClientRect();
      for (const row of document.querySelectorAll('#tlBody [data-hook="tl-space"]')) { const lane = row.querySelector('.tl-lane'); if (!lane) continue; const r = lane.getBoundingClientRect();
        if (r.top < v.top + 60 || r.bottom > v.bottom - 20) continue;
        for (let x = Math.max(r.left, v.left + 200) + 3; x < Math.min(r.right, v.right) - 20; x += 13) { const el = document.elementFromPoint(x, r.top + r.height / 2); if (el === lane) return { x: Math.round(x), y: Math.round(r.top + r.height / 2), was: +S.date }; } }
      return null;""")
    check("the Timeline has a bare stretch of a row to click", bool(bare), bare)
    if bare:
        js("hush(); return 1;")
        page.mouse.click(bare["x"], bare["y"]); wait(300)
        moved = js("return { now: +S.date, said: said(), offers: offers(), sel: S.sel && S.sel.type, wasDay: UI.day(new Date(arg.was)), nowDay: UI.day(S.date) };", bare)
        check("a click on a bare row of the Timeline moves the date to the day clicked and says so: “The date is now <day> (was <day>)”", moved["now"] != bare["was"] and moved["said"] == "The date is now %s (was %s)" % (moved["nowDay"], moved["wasDay"]), moved)
        check("with Undo as its one action, and the bed picked as before", moved["offers"] == ["Undo"] and moved["sel"] == "bed", moved)
        back = js("press('Undo'); await sleep(250); return { now: +S.date, undo: S.undo.length };")
        check("Undo puts the date back where it was", back["now"] == bare["was"], {"back": back, "was": bare["was"]})

    # ══ 9. his own days typed for a crop: the varieties that keep theirs, set too (what moves shown first), and the plantings ══
    days = js("""A.select(null); A.setView('assume'); await sleep(600); hush();
      const own = (cropId, env) => { const vs = new Map(); for (const p of S.plan.plantings) { if (p.cropId !== cropId) continue; const b = eng().bedOf(p.bedId); if (!b || eng().envOf(b) !== env || eng().pinned(p)) continue;
          const x = eng().effective(p), v = eng().variety(p.varietyId); if (x && v && v.cropId === cropId && !(x.assumed && x.assumed.level === 'crop')) vs.set(v.id, Math.max(vs.get(v.id) || 0, x.dtm || 0)); } return vs; };
      const subj = (() => { for (const c of eng().crops()) { if (c.micro) continue; for (const env of eng().ENVS) { const vs = own(c.id, env); if (vs.size === 2) return { cropId: c.id, name: c.name, env, vs: [...vs.keys()], most: Math.max(...vs.values()), names: [...vs.keys()].map(id => eng().variety(id).name) }; } } return null; })();
      if (!subj) return null;
      // more days than either variety has now, so that setting them moves their plantings
      const n = Math.max(subj.most, eng().crop(subj.cropId).dtm || 0) + 5, label = subj.name + ', ' + LRFAssume.LABEL[subj.env].toLowerCase() + ': ' + n + ' days', steps = S.undo.length;
      const typed = A.setAssumption('crops', subj.cropId, subj.env, n, label); await apply(); await typed; await sleep(250);
      return { ...subj, n, label, said: said(), offers: offers(), steps: S.undo.length - steps };""")
    check("the plan has a crop whose plantings in one place follow two varieties with days of their own, for the check to type over", bool(days), days)
    if days:
        name2 = " and ".join(days["names"])
        check("his days typed for the crop: the answer names the two varieties that keep days of their own", days["steps"] == 1 and days["said"].startswith(days["label"]) and (name2 + " keep days of their own") in days["said"], days)
        check("and offers to set its 2 varieties too and to see the plantings, after Undo", days["offers"] == ["Undo", "Set its 2 varieties too", "See the plantings"], days)
        cell = "const a = S.plan.assumptions || {}, cell = id => (((a.varieties || {})[id] || {})[arg.env] || {}).dtm || null;"
        ask = js(cell + """const steps = S.undo.length; press('Set its 2 varieties too'); await sleep(400);
          const d = document.querySelector('dialog[open]'), out = { asked: !!d, title: d && d.querySelector('h2') ? d.querySelector('h2').textContent : '', moves: d ? d.querySelectorAll('#assumeMoves li').length : 0, steps: S.undo.length - steps, set: arg.vs.map(cell) };
          if (d && d.querySelector('.btn.primary')) { d.querySelector('.btn.primary').click(); await sleep(500); }
          const b = S.plan.assumptions || {}, now = id => (((b.varieties || {})[id] || {})[arg.env] || {}).dtm || null;
          return { ...out, after: { steps: S.undo.length - steps, set: arg.vs.map(now), said: said(), offers: offers(), label: S.undo.length ? S.undo[S.undo.length - 1].label : '' } };""", days)
        check("“Set its 2 varieties too” first shows what it would move, crop by crop, and nothing has changed while it asks (Codex on #93)", ask["asked"] and (name2 + " too") in ask["title"] and ask["moves"] >= 1 and ask["steps"] == 0 and ask["set"] == [None, None], ask)
        aft = ask["after"]
        check("applied, both varieties take the same days, in a step of its own that says what it did", aft["steps"] == 1 and aft["set"] == [days["n"], days["n"]] and (name2 + " too") in aft["label"] and aft["said"].startswith(aft["label"]), ask)
        check("and its answer still offers to see the plantings, after its Undo (Codex on #93)", aft["offers"] == ["Undo", "See the plantings"], ask)
        see = js("""press('See the plantings'); await sleep(500); const d = document.getElementById('asDifferDlg'); const out = { open: !!d && d.open, view: S.view };
          if (d && d.open) { const done = document.getElementById('asDifferDone'); if (done) done.click(); await sleep(200); } return out;""")
        check("“See the plantings” opens the plantings that differ from the list", see["open"] is True and see["view"] == "assume", see)
        undo = js(cell + """A.undo(); await sleep(400); const b = S.plan.assumptions || {}, now = id => (((b.varieties || {})[id] || {})[arg.env] || {}).dtm || null;
          const out = { set: arg.vs.map(now), crop: (((b.crops || {})[arg.cropId] || {})[arg.env] || {}).dtm || null }; A.undo(); await sleep(400); return out;""", days)
        check("Undo takes the varieties' days back, and leaves the crop's", undo["set"] == [None, None] and undo["crop"] == days["n"], undo)

    # ══ 10. the unheated benches, and a celled tray with no cells set, in plain words ══
    words = js("""A.setView('trays'); LRFTraysView.setTab('setup'); await sleep(600); const heads = [...document.querySelectorAll('#bnCool h4')].map(x => x.textContent);
      const c = eng().crops().find(x => x.micro && S.plan.crops.some(y => y.id === x.id) && eng().liveSow(x).how === 'cells');
      let row = null;
      if (c && A.setLiveSow(c.id, { cells: null })) { await sleep(200); const r = LRFNursery.supplies(eng(), A.planYear(), null).rows.find(x => x.id === 'live-unsaid'); row = r ? { name: r.name, text: JSON.stringify(r) } : { none: true }; A.undo(); await sleep(200); }
      return { heads, row, old: document.body.innerText.includes('without heat') };""")
    check("on the Nursery's set-up, the crops grown on the unheated benches stand under “On the unheated benches”", words["heads"] == ["On the unheated benches"], words)
    check("a live tray sown in cells with no cells set is a supply named “Celled tray, cells a tray not set”, said to be set under Live trays, in the Sown column", bool(words["row"]) and words["row"].get("name") == "Celled tray, cells a tray not set" and "under Live trays, in the Sown column" in words["row"].get("text", ""), words)

    # ══ 11. "Seeding in trays" fits its "Days counted from" box: a crop's row set to it shows the words whole ══
    fits = js("""A.setView('assume'); LRFAssume.setMode('days'); await sleep(600); const c = document.createElement('canvas').getContext('2d');
      const row = [...document.querySelectorAll('#asBody select[data-start]')].find(el => el.getClientRects().length && el.value !== 'seed'); if (!row) return null;
      const id = row.dataset.start, steps = S.undo.length; const t = A.setStart(id, { from: 'seed' }, 'Days counted from seeding in trays'); await apply(); await t; await sleep(500);
      const el = document.querySelector('#asBody select[data-start="' + CSS.escape(id) + '"]'), o = el && el.selectedOptions[0];
      if (!o) return { none: true }; c.font = getComputedStyle(el).font;
      const out = { text: o.textContent, need: Math.round(c.measureText(o.textContent).width + 26), width: Math.round(el.getBoundingClientRect().width), steps: S.undo.length - steps };
      if (out.steps) { A.undo(); await sleep(400); } return out;""")
    check("a crop's row set to count its days from “Seeding in trays” shows the words whole in its box", bool(fits) and fits.get("text") == "Seeding in trays" and fits["need"] <= fits["width"] + 1, fits)

    # ══ 12. with nothing counted, what can wait is reached from the Assumptions page ══
    loose = js("""A.setView('assume'); await sleep(500); const before = { badge: drawn(document.getElementById('settleBadge')), link: drawn(hook('loose-link')) };
      const c = LRFRails.cleanup(eng()), ids = new Set([...c.long.map(x => x.p.id), ...c.groups.map(g => g.late.id)]);
      A.removePlantings([...ids]); await sleep(500);
      const rows = LRFPanels.looseEnds(), needs = LRFPanels.needsYou(rows);
      const now = { needs, rows: rows.length, badge: drawn(document.getElementById('settleBadge')), link: drawn(hook('loose-link')), text: hook('loose-link') && hook('loose-link').textContent };
      if (now.link) { hook('loose-link').click(); await sleep(300); }
      const list = document.getElementById('looseList'); now.open = !!list && drawn(list); now.listed = list ? list.querySelectorAll('[data-loose]').length : 0;
      now.under = list && hook('loose-link') ? Math.round(list.getBoundingClientRect().top - hook('loose-link').getBoundingClientRect().bottom) : null;
      hook('loose-link') && hook('loose-link').click(); await sleep(200); now.shut = !document.getElementById('looseList');
      A.undo(); await sleep(500); const back = { badge: drawn(document.getElementById('settleBadge')), link: drawn(hook('loose-link')) };
      return { before, now, back };""")
    n = loose.get("now") or {}
    check("while something needs him, Loose ends is in the header and the Assumptions page has no link", loose["before"]["badge"] is True and loose["before"]["link"] is False, loose)
    check("with nothing counted, Loose ends leaves the header, and one quiet link on the Assumptions page says how many loose ends can wait", n.get("needs") == 0 and n.get("badge") is False and n.get("link") is True and n.get("text") == "%d loose end%s" % (n.get("rows", 0), "" if n.get("rows") == 1 else "s"), loose)
    check("the link opens the same list under it, every row of it, and closes it again", n.get("open") is True and n.get("listed") == n.get("rows") and n.get("under") is not None and 0 <= n["under"] <= 16 and n.get("shut") is True, loose)
    check("once something needs him again, the button is back in the header and the link goes", loose["back"]["badge"] is True and loose["back"]["link"] is False, loose)

    # ══ 13. the map's key wraps before it hides, and the map holds still ══
    KEY = """A.select(null); A.setView('map'); await sleep(500);
      const chips = hooks('legend-chip'), shown = chips.filter(x => !x.hidden), more = hook('legend-more'), tops = [...new Set(shown.map(x => x.offsetTop))].sort((a, b) => a - b);
      const svg = document.getElementById('map').getBoundingClientRect(), view = document.getElementById('mapView').getBoundingClientRect();
      return { n: chips.length, shown: shown.length, lines: tops.length, first: shown.filter(x => x.offsetTop === tops[0]).length, more: more.textContent, hidden: chips.length - shown.length,
        still: Math.abs(svg.height - view.height) < 1.5 && Math.abs(svg.top - view.top) < 1.5, docked: !!(window.LRFCard && LRFCard.docked && LRFCard.docked()) };"""
    keys = {}
    for w in (3440, 1480, 800):
        page.set_viewport_size({"width": w, "height": 960}); wait(600); keys[w] = js(KEY)
    # the map moved by hand, then the key turned from two lines to fewer by another date: the map stays where it was put (#85's rule)
    page.set_viewport_size({"width": 1480, "height": 960}); wait(500)
    js("A.setDate(new Date(A.planYear(), 5, 15)); await sleep(400); return 1;")
    box = js("const r = document.getElementById('map').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };")
    page.mouse.move(box["x"], box["y"])
    for _ in range(2): page.mouse.wheel(0, -200); wait(80)
    wait(400)
    LINES = "const t = [...new Set(hooks('legend-chip').filter(x => !x.hidden).map(x => x.offsetTop))]; return { lines: t.length, frame: document.getElementById('mapWorld').getAttribute('transform') };"
    held1 = js(LINES)
    lines2 = None
    for m in (0, 1, 2, 3, 10, 11):
        held2 = js("A.setDate(new Date(A.planYear(), arg, 10)); await sleep(500); " + LINES, m)
        if held2["lines"] != held1["lines"]: lines2 = held2; break
    js("A.setDate(new Date(A.planYear(), 5, 15)); LRFMap.fit(); await sleep(300); return 1;")
    page.set_viewport_size({"width": 1707, "height": 960}); wait(400)
    page.evaluate("try { localStorage.setItem('lrf.tryCard', '1'); } catch (_) {}")
    open_page()
    resize("card")
    keys["docked"] = js("""A.setView('map'); await sleep(400); const b = S.plan.beds.find(x => x.active !== false && eng().isSoilBed(x) && LRFCard.bedSeasonOn(x)); A.select({ type: 'bed', id: b.id }); await sleep(800); """ + KEY.replace("A.select(null); ", ""))
    page.evaluate("try { localStorage.removeItem('lrf.tryCard'); } catch (_) {}")
    ok_lines = lambda k: k["lines"] <= 2 and (k["hidden"] == 0 or k["lines"] == 2) and k["more"] == ("+%d" % k["hidden"] if k["hidden"] else "Key")
    check("at 1480 the key's groups stand on two lines rather than hide: more show than one line holds, and “+n” counts only what two lines cannot", ok_lines(keys[1480]) and keys[1480]["lines"] == 2 and keys[1480]["shown"] > keys[1480]["first"], keys)
    check("at 1707 with a bed's card docked beside the map, the same: two lines before any group waits behind “+n”", keys["docked"]["docked"] and ok_lines(keys["docked"]) and (keys["docked"]["hidden"] == 0 or keys["docked"]["shown"] > keys["docked"]["first"]), keys)
    check("on a wide window every group shows on one line, and on a narrow one what two lines cannot hold waits behind “+n”", keys[3440]["lines"] == 1 and keys[3440]["hidden"] == 0 and keys[3440]["more"] == "Key" and ok_lines(keys[800]) and keys[800]["hidden"] >= 1, keys)
    check("the key stands over the map: a second line takes nothing from the map's own size", all(k["still"] for k in keys.values()), keys)
    check("a map moved by hand holds still while its key goes from two lines to fewer", bool(lines2) and held1["lines"] == 2 and lines2["frame"] == held1["frame"], {"two": held1, "fewer": lines2})

    page.screenshot(path=str(shots / "messages.png"))
    check("no error on the page", not [e for e in errors if "pageerror" in e], errors[:4])
    browser.close()

try:
    with sync_playwright() as pw: run(pw)
except Exception as e:
    check("the check ran to its end", False, repr(e)[:600])
finish()
