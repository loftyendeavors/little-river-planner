"""Step 5a in a real browser: the Week view (sowing and the other jobs), recording on the real day, what a late job pushes
and how that is said first, taking back, the plan of record, the planting's own schedule, the printed sheet, the phone page.
The page is told it is Wednesday May 5 of the plan's year, so there is a past to record and a future that is a plan.
usage: python3 -I step5a_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
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
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}))
    sys.stdout.flush(); os._exit(1 if failed else 0)
def fake(y):   # the page's clock: Wednesday May 5 of the plan's year, ten in the morning
    return f"(() => {{ const R = Date, off = new R({y}, 4, 5, 10).getTime() - R.now(); class D extends R {{ constructor(...a) {{ if (a.length) super(...a); else super(R.now() + off); }} static now() {{ return R.now() + off; }} }} window.Date = D; }})();"
PRE = "const A = LRFApp, S = A.state, E = LRFEngine, V = LRFSowView, W = LRFWeek, SL = LRFSeedLib, T = LRFTrays, $ = id => document.getElementById(id), now = T.monday(A.today());"
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def open_page(width, height, year=2027):
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme="dark" if DARK else "light")
        page = ctx.new_page(); page.add_init_script(fake(year))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
        if backup:
            page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
        return ctx, page
    ctx, page = open_page(WIDTH, 900)
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    ajs = lambda body: page.evaluate("(async () => { " + PRE + " " + body + " })()")
    wait = lambda ms=350: page.wait_for_timeout(ms)
    row = lambda key: page.locator(f'table.sw tbody tr[data-line={json.dumps(key)}]')
    def set_date(iso):
        page.locator(".sw-record input[type=date]").fill(iso); page.locator(".sw-record input[type=date]").dispatch_event("change"); wait(450)

    # ── the view ──
    page.click('[data-view-btn="sow"]'); wait(600)
    first = js("""const f = V.figures(), j = V.jobs(), week = f.list.filter(l => l.week === now), wj = j.filter(l => l.week === now && !l.passed);
      const secs = {}; for (const s of document.querySelectorAll('.view-sow .sw-wrap > .wk-half > .wk-kind')) secs[s.dataset.kind] = s.querySelectorAll('tbody tr[data-line]').length;
      const want = {}; for (const l of wj) want[l.section] = (want[l.section] || 0) + 1;
      const tiles = [...document.querySelectorAll('.sw-stats .tr-stat')].map(e => [...e.children].map(c => c.textContent));
      const early = f.list.filter(l => l.week < now && l.state !== 'done').length + j.filter(l => l.week < now && l.state !== 'done').length;
      return { today: A.today(), now, nav: document.querySelector('[data-view-btn="sow"]').textContent, pressed: document.querySelector('[data-view-btn="sow"]').getAttribute('aria-pressed'), h2: document.querySelector('.view-sow h2').textContent,
        sowRows: document.querySelectorAll('.view-sow .sw-wrap > .wk-half > .sw-kind tbody tr[data-line]').length, sow: week.length, secs, want, tiles, early, summary: (document.querySelector('.sw-earlier summary b') || {}).textContent || '',
        open: wj.filter(l => l.state !== 'done').length, dark: getComputedStyle(document.body).backgroundColor, order: [...document.querySelectorAll('.view-sow .sw-wrap > .wk-half > section.sw-kind, .view-sow .sw-wrap > .wk-half > section.wk-kind')].map(s => s.className.split(' ')[0] + ':' + s.dataset.kind),
        sideways: document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1, print: !!$('wkPrint'), bench: !!document.querySelector('.view-sow .bn'), line: !!document.querySelector('.view-sow #bnLine') };""")
    check("the page believes it is May 5 of the plan's year, and the week is that week", first["today"].endswith("-05-05") and first["now"].endswith("-05-03"), first)
    check("the view is called Tasks, and says what it is", first["nav"] == "Tasks" and first["pressed"] == "true" and first["h2"] == "This week’s tasks", first)
    check("the sowing lists are there as before: one row per sowing of the week", first["sow"] > 0 and first["sowRows"] == first["sow"], first)
    check("after them, a section for each other job the week has, with one row per line", first["secs"] == first["want"] and len(first["want"]) >= 2, first)
    check("the nursery's work comes first (seedling trays, tower seedlings, live trays, pot up, harden off), then the field's (sown in the ground, plant out, move out): 0.31", (lambda o: o == sorted(o, key=lambda x: ["sw-kind:plugs", "sw-kind:rockwool", "sw-kind:live", "wk-kind:potup", "wk-kind:harden", "sw-kind:direct", "wk-kind:plant", "wk-kind:move"].index(x)))(first["order"]), first["order"])
    check("six tiles: the other jobs of the week are counted beside the sowing", len(first["tiles"]) == 6 and first["tiles"][3][0] == "Other tasks" and first["tiles"][3][1] == f"{first['open']} to do" and first["tiles"][0][1].endswith("to sow"), first["tiles"])
    check("jobs planned before this week and not recorded are counted with the sowings, and folded away", first["early"] > 0 and first["tiles"][4][1] == f"{first['early']:,}" and f"{first['early']:,} earlier task" in first["summary"], first)
    check("no sideways scroll; a print button; below, one line of bench room and not the chart (0.31: the chart is in the Nursery)", not first["sideways"] and first["print"] and not first["bench"] and first["line"], first)
    fit = js("""const bad = []; for (const e of document.querySelectorAll('.sw-stats .tr-stat span, .sw-stats .tr-stat strong, .sw-kind-head h4, .view-sow .chip, #wkPrint, .tr-stepper b')) if (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth) bad.push(e.textContent);
      for (const td of document.querySelectorAll('.wk-kind td.sw-how span, .wk-kind td.sw-when b, .wk-kind td.sw-seed small')) { const c = td.closest('td'); if (td.getBoundingClientRect().right > c.getBoundingClientRect().right + 1) bad.push(td.textContent); }
      return bad;""")
    check("no label is clipped and no figure spills out of its column", fit == [], fit[:6])
    page.screenshot(path=str(shots / f"week-{WIDTH}.png"))

    # ── a job done late: said first, then one step ──
    pick = js("""const j = V.jobs().filter(l => l.week === now && l.state === 'open'), today = A.today();
      const hard = j.find(l => l.section === 'harden' && l.date < today && l.date >= now), p = hard.members[0].p, r = hard.members[0].r;
      return { key: hard.key, ids: hard.members.map(m => m.p.id), dates: hard.members.map(m => m.p.date), late: E.dayDiff(E.s2d(today), E.s2d(hard.date)), first: E.d2s(r.first), undo: S.undo.length, name: hard.name, snaps: 0 };""")
    snaps0 = ajs("return (await A.snapshots()).rows.filter(s => /^Plan of record/.test(s.name)).length;")
    row(pick["key"]).locator('input[type="checkbox"]').check(); wait(500)
    bar = js("""const b = document.querySelector('.sw-record'), f = $('wkFollow'); return b ? { text: b.querySelector('b').textContent, button: $('swRecord').textContent, label: b.querySelector('label span').textContent, date: b.querySelector('input[type=date]').value,
      follow: f ? { on: f.querySelector('input').checked, text: f.textContent } : null, sticky: getComputedStyle(b).position, inView: b.getBoundingClientRect().bottom <= innerHeight + 1 } : null;""")
    n = len(pick["ids"]); late = pick["late"]
    check("ticking a job brings up the bar: one job ticked, done on today", bar and bar["text"] == "1 task ticked" and bar["button"] == "Record 1 task" and bar["label"] == "Done on" and bar["date"] == first["today"] and bar["inView"], bar)
    check("before anything is recorded the bar says what the late job pushes: how late, how many plantings, how far", bar and bar["follow"] and bar["follow"]["on"] and f"Late by {late} day" in bar["follow"]["text"] and f"{n} planting" in bar["follow"]["text"] and f"{late} day{'s' if late != 1 else ''} later" in bar["follow"]["text"], bar)
    page.screenshot(path=str(shots / f"week-follow-{WIDTH}.png"))
    still = js(f"return {{ dates: {json.dumps(pick['ids'])}.map(id => S.engine.planting(id).date), undo: S.undo.length }};")
    check("looking at what it would do changes nothing", still["dates"] == pick["dates"] and still["undo"] == pick["undo"], still)
    page.click("#swRecord"); wait(900)
    after = ajs(f"""const ids = {json.dumps(pick['ids'])}, ps = ids.map(id => S.engine.planting(id)), today = A.today(), r = S.engine.calc(ps[0]);
      const line = V.jobs().find(l => l.section === 'harden' && l.members.some(m => m.p.id === ids[0])), out = V.jobs().find(l => l.section === 'plant' && l.members.some(m => m.p.id === ids[0]));
      const tr = document.querySelector('table.sw tbody tr[data-line=' + JSON.stringify(line.key) + ']');
      return {{ done: ps.every(p => p.done && p.done.harden === today), dates: ps.map(p => p.date), undo: S.undo.length, label: S.undo[S.undo.length - 1].label, first: E.d2s(r.first), toast: (document.querySelector('.toast') || {{}}).textContent || '',
        state: line.state, rowState: tr && tr.dataset.state, rowText: tr ? tr.querySelector('td.sw-seed').textContent : '', dayCell: tr ? tr.querySelector('td.sw-when').textContent : '', tall: tr ? tr.getBoundingClientRect().height : 0, tick: tr ? tr.querySelector('td.sw-pick').textContent : '', back: tr ? !!tr.querySelector('td.sw-act button') : false, bar: !!document.querySelector('.sw-record'),
        outDate: out.date, outPushed: out.pushed.length, snaps: (await A.snapshots()).rows.filter(s => /^Plan of record/.test(s.name)).map(s => [s.name, s.auto, s.plantings]) }};""")
    plus = lambda iso, k: js(f"return E.d2s(E.addDays(E.s2d('{iso}'), {k}));")
    check("one press dates the job on the real day and moves each planting as many days later, as one step", after["done"] and after["dates"] == [plus(d, late) for d in pick["dates"]] and after["undo"] == pick["undo"] + 1 and "1 task recorded" in after["label"], after)
    check("the harvest follows", after["first"] == plus(pick["first"], late), after)
    check("the toast says what moved, and offers Undo", f"out {late} day" in after["toast"] and "later" in after["toast"] and "recorded" in after["toast"], after["toast"])
    check("the line reads as done: a tick, the day, how late, what went with it, and a way to take it back", after["state"] == "done" and after["rowState"] == "done" and "✓" in after["tick"] and after["dayCell"].endswith("May 5") and f"{late} day{'s' if late != 1 else ''} late" in after["rowText"] and f"out {late} day" in after["rowText"] and after["back"] and not after["bar"], after)
    check("a done line is no taller than two short lines of status make it", 0 < after["tall"] <= 52, after["tall"])
    check("planting out is listed on its new day", after["outDate"] == plus(pick["dates"][0], late) and after["outPushed"] >= 1, after)
    check("the plan as it stood before the first recorded work is kept as a named snapshot, once", snaps0 == 0 and len(after["snaps"]) == 1 and str(2027) in after["snaps"][0][0] and not after["snaps"][0][1] and "plan of record" in after["toast"], after["snaps"])
    page.screenshot(path=str(shots / f"week-recorded-{WIDTH}.png"))
    # the pushed plant-out line says why it is not where it was
    tag = js(f"""const out = V.jobs().find(l => l.section === 'plant' && l.members.some(m => m.p.id === {json.dumps(pick['ids'][0])})); A.setDate(E.s2d(out.date)); return out.key;"""); wait(500)
    tagText = js(f"const tr = document.querySelector('table.sw tbody tr[data-line={json.dumps(tag)}]'); return tr ? tr.querySelector('td.sw-seed').textContent : null;")
    check("where the planting now goes out, its line says it is later than first planned", tagText is not None and f"{late} day{'s' if late != 1 else ''} later" in tagText, tagText)
    js("A.setDate(E.s2d(A.today()))"); wait(400)

    # take back: the day is cleared and the plantings return
    line_key = js(f"return V.jobs().find(l => l.section === 'harden' && l.members.some(m => m.p.id === {json.dumps(pick['ids'][0])})).key;")
    row(line_key).locator("td.sw-act button").click(); wait(700)
    back = js(f"const ps = {json.dumps(pick['ids'])}.map(id => S.engine.planting(id)); return {{ cleared: ps.every(p => !(p.done && p.done.harden)), dates: ps.map(p => p.date), undo: S.undo.length, toast: (document.querySelector('.toast') || {{}}).textContent || '' }};")
    check("Take back clears the day and puts the plantings back where they were first planned, in one step", back["cleared"] and back["dates"] == pick["dates"] and back["undo"] == pick["undo"] + 2 and "taken back" in back["toast"] and "first planned" in back["toast"], back)
    page.keyboard.press("Control+z"); wait(500); page.keyboard.press("Control+z"); wait(500)
    undone = js(f"const ps = {json.dumps(pick['ids'])}.map(id => S.engine.planting(id)); return {{ clean: ps.every(p => !p.done), dates: ps.map(p => p.date), undo: S.undo.length }};")
    check("undo twice returns to before anything was recorded", undone["clean"] and undone["dates"] == pick["dates"] and undone["undo"] == pick["undo"], undone)

    # the same job with "later dates follow" off
    row(pick["key"]).locator('input[type="checkbox"]').check(); wait(450)
    page.locator("#wkFollow input").uncheck(); wait(450)
    off = js("const f = $('wkFollow'); return f ? { on: f.querySelector('input').checked, text: f.textContent } : null;")
    check("unticking “Later dates follow” says the days are kept", off and not off["on"] and "keep" in off["text"], off)
    page.click("#swRecord"); wait(800)
    kept = ajs(f"const ps = {json.dumps(pick['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.harden === A.today()), dates: ps.map(p => p.date), toast: (document.querySelector('.toast') || {{}}).textContent || '', snaps: (await A.snapshots()).rows.filter(s => /^Plan of record/.test(s.name)).length }};")
    check("then the job is dated and nothing moves", kept["done"] and kept["dates"] == pick["dates"] and "later" not in kept["toast"], kept)
    check("the plan of record is not taken a second time", kept["snaps"] == 1, kept)
    page.keyboard.press("Control+z"); wait(500)

    # ── early work pulls nothing; planting out is a fact the harvest is counted from ──
    ahead = js("""const j = V.jobs().filter(l => l.week === now && l.state === 'open'), today = A.today();
      const h = j.find(l => l.section === 'harden' && l.date > today), pl = V.jobs().find(l => l.state === 'open' && l.section === 'plant' && !l.stock && l.date > today && l.members.every(m => m.r.plannedSow && W.steps(S.engine, m.p).some(s => s.kind === 'harden')));
      return { h: h && { key: h.key, ids: h.members.map(m => m.p.id), dates: h.members.map(m => m.p.date) }, pl: pl && { key: pl.key, ids: pl.members.map(m => m.p.id), dates: pl.members.map(m => m.p.date), firsts: pl.members.map(m => E.d2s(m.r.first)), early: E.dayDiff(E.s2d(pl.date), E.s2d(today)) } };""")
    if ahead["h"]:
        row(ahead["h"]["key"]).locator('input[type="checkbox"]').check(); wait(450)
        nofollow = js("return { follow: !!$('wkFollow'), button: $('swRecord').textContent };")
        page.click("#swRecord"); wait(700)
        e = js(f"const ps = {json.dumps(ahead['h']['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.harden === A.today()), dates: ps.map(p => p.date) }};")
        check("a job done early offers nothing to follow, and moves nothing", not nofollow["follow"] and e["done"] and e["dates"] == ahead["h"]["dates"], [nofollow, e])
        page.keyboard.press("Control+z"); wait(500)
    else: check("a job done early offers nothing to follow, and moves nothing (no such job this week)", True)
    check("the week has, after today, a job of each kind to try early: hardening off, and planting out what was hardened off", bool(ahead["h"]) and bool(ahead["pl"]), ahead)
    if ahead["pl"]:
        js(f"A.setDate(E.s2d({json.dumps(ahead['pl']['key'].split('|')[2])}))"); wait(500)   # its own week, which may be a later one
        row(ahead["pl"]["key"]).locator("td.sw-what").click(); wait(450)
        page.click("#swRecord"); wait(800)
        e = js(f"const ps = {json.dumps(ahead['pl']['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.field === A.today()), dates: ps.map(p => p.date), firsts: ps.map(p => E.d2s(S.engine.calc(p).first)), use: ps.every(p => !((p.workflow || {{}}).seedUse || []).length), sow: ps.map(p => W.steps(S.engine, p).find(s => s.kind === 'sow').passed) }};")
        k = ahead["pl"]["early"]
        check("planting out recorded early keeps the plan's day as the plan and brings the harvest forward by the engine's own count", e["done"] and e["dates"] == ahead["pl"]["dates"] and e["firsts"] == [plus(f, -k) for f in ahead["pl"]["firsts"]] and e["use"], e)
        check("its sowing, never recorded, is passed over: not waiting, not assumed", all(e["sow"]), e)
        gone = js(f"const id = {json.dumps(ahead['pl']['ids'][0])}; return {{ waiting: V.figures().list.filter(l => l.state !== 'done' && l.members.some(m => m.p.id === id && !m.s.done && !m.s.sown)).length, harden: V.jobs().filter(l => l.section === 'harden' && l.open.some(m => m.p.id === id)).length }};")
        check("so neither its sowing nor its hardening off is listed as still to do", gone["waiting"] == 0 and gone["harden"] == 0, gone)
        page.keyboard.press("Control+z"); wait(500)
        js("A.setDate(E.s2d(A.today()))"); wait(400)

    # ── sowing and other jobs in one step; the old words when it is sowing alone ──
    mix = js("""const f = V.figures(), j = V.jobs(), today = A.today();
      const sow = f.list.find(l => l.week === now && l.state === 'open' && l.kind === 'plugs') || f.list.find(l => l.week === now && l.state === 'open' && l.kind !== 'live');
      const bulb = j.find(l => l.week === now && l.state === 'open' && l.stock && l.date <= today), plant = j.find(l => l.week === now && l.state === 'open' && l.section === 'plant' && !l.stock && l.date <= today);
      return { sow: sow && { key: sow.key, ids: sow.members.map(m => m.p.id), kind: sow.kind, date: sow.date, estimate: sow.estimate, dates: sow.members.map(m => m.p.date) }, bulb: bulb && { key: bulb.key, ids: bulb.members.map(m => m.p.id), unit: bulb.stock.unit, estimate: bulb.estimate, date: bulb.date },
        plant: plant && { key: plant.key, ids: plant.members.map(m => m.p.id), date: plant.date }, undo: S.undo.length };""")
    row(mix["sow"]["key"]).locator('input[type="checkbox"]').check(); wait(450)
    alone = js("const b = document.querySelector('.sw-record'); return { text: b.querySelector('b').textContent, button: $('swRecord').textContent, label: b.querySelector('label span').textContent };")
    check("a sowing ticked alone keeps its words: sowings, sown on", alone["text"] == "1 sowing ticked" and alone["button"] == "Record 1 sowing" and alone["label"] == "Sown on", alone)
    other = mix["bulb"] or mix["plant"]
    row(other["key"]).locator('input[type="checkbox"]').check(); wait(450)
    both = js("const b = document.querySelector('.sw-record'); return { text: b.querySelector('b').textContent, button: $('swRecord').textContent, label: b.querySelector('label span').textContent };")
    check("with another job ticked beside it they are jobs, done on a day", both["text"] == "2 tasks ticked" and both["button"] == "Record 2 tasks" and both["label"] == "Done on", both)
    day0 = min(mix["sow"]["date"], other["date"])
    set_date(day0)
    page.click("#swRecord"); wait(900)
    two = js(f"""const sow = {json.dumps(mix['sow']['ids'])}.map(id => S.engine.planting(id)), oth = {json.dumps(other['ids'])}.map(id => S.engine.planting(id)), use = p => ((p.workflow || {{}}).seedUse || []).reduce((n, u) => n + u.quantity, 0);
      return {{ sown: sow.every(p => p.done && (p.done.sow === '{day0}' || p.done.field === '{day0}')), planted: oth.every(p => p.done && p.done.field === '{day0}'), seed: sow.map(use).reduce((a, b) => a + b, 0), units: oth.map(use).reduce((a, b) => a + b, 0), undo: S.undo.length, label: S.undo[S.undo.length - 1].label, dates: sow.map(p => p.date) }};""")
    total = len(mix["sow"]["ids"]) + len(other["ids"])
    check("one press records the sowing and the other job on the day typed, as one step", two["sown"] and two["planted"] and two["undo"] == mix["undo"] + 1 and f"{total} task" in two["label"], two)
    check("the seed the sowing used is recorded as it always was", two["seed"] == mix["sow"]["estimate"], [two["seed"], mix["sow"]["estimate"]])
    if mix["bulb"]: check("what was planted and not sown records what it used, in its own unit", two["units"] == mix["bulb"]["estimate"], [two["units"], mix["bulb"]])
    page.keyboard.press("Control+z"); wait(600)

    # ── a day after today is a plan, never a record ──
    row(other["key"]).locator('input[type="checkbox"]').check(); wait(400)
    set_date(js("return E.d2s(E.addDays(E.s2d(A.today()), 3));"))
    fut = js("const b = document.querySelector('.sw-record'); return { disabled: $('swRecord').disabled, note: (b.querySelector('.sw-later') || {}).textContent || '', follow: !!$('wkFollow') };")
    check("a job cannot be recorded on a day after today: the button is off and the bar says why", fut["disabled"] and "not a record" in fut["note"] and not fut["follow"], fut)
    row(mix["sow"]["key"]).locator('input[type="checkbox"]').check(); wait(400)
    fut2 = js("return { disabled: $('swRecord').disabled, button: $('swRecord').textContent };")
    check("with a sowing ticked too, the day is offered as a plan for the sowing alone", not fut2["disabled"] and fut2["button"].startswith("Plan 1 sowing for"), fut2)
    page.locator(".sw-record .btn", has_text="Clear").click(); wait(400)
    cleared = js("return { bar: !!document.querySelector('.sw-record'), undo: S.undo.length };")
    check("Clear leaves without doing anything", not cleared["bar"] and cleared["undo"] == mix["undo"], cleared)

    # ── earlier, not recorded ──
    page.locator(".sw-earlier summary").click(); wait(900)
    earl = js("""const d = document.querySelector('.sw-earlier'); const j = V.jobs().filter(l => l.week < now && l.state !== 'done'), f = V.figures().list.filter(l => l.week < now && l.state !== 'done');
      return { open: d.open, rows: d.querySelectorAll('tbody tr[data-line]').length, want: j.length + f.length, kinds: [...new Set([...d.querySelectorAll('section')].map(s => s.dataset.kind))], head: d.querySelector('.wk-kind th.sw-when').textContent };""")
    check("the earlier jobs open in place: every sowing and every other job not recorded, by the day planned", earl["open"] and earl["rows"] == earl["want"] and "harden" in earl["kinds"] and "plant" in earl["kinds"] and earl["head"] == "Planned", earl)
    page.locator(".sw-earlier summary").click(); wait(500)

    # ── the planting's own schedule ──
    one = js("""const today = A.today(), x = S.plan.plantings.map(p => ({ p, r: S.engine.calc(p), st: W.steps(S.engine, p) })).find(x => x.r && !x.r.tw && !x.r.ct && x.st.some(s => s.kind === 'harden' && E.d2s(s.planned) < today && E.d2s(s.planned) >= '2027-04-20') && !x.p.done);
      return { id: x.p.id, date: x.p.date, kinds: x.st.map(s => s.kind), harden: E.d2s(x.st.find(s => s.kind === 'harden').planned), late: E.dayDiff(E.s2d(today), x.st.find(s => s.kind === 'harden').planned), undo: S.undo.length };""")
    js(f"A.setView('map'); A.select({{ type: 'planting', id: {json.dumps(one['id'])} }});"); wait(700)
    sched = js("return { jobs: [...document.querySelectorAll('#jobList li[data-job]')].map(li => [li.dataset.job, li.dataset.state, !!li.querySelector('[data-job=tick]')]), rest: [...document.querySelectorAll('#jobList li:not([data-job]) span')].map(s => s.textContent) };")
    check("a planting's schedule lists its jobs in order, then its harvest", [j[0] for j in sched["jobs"]] == one["kinds"] and sched["rest"][:1] == ["First harvest"] and "Ground free again" in sched["rest"], sched)
    check("the jobs that use no seed can be recorded there; the sowing is recorded in its own box below", all(j[2] == (j[0] != "sow") for j in sched["jobs"]), sched)
    page.locator('#jobList li[data-job="harden"] [data-job="tick"]').click(); wait(400)
    typed = js("const i = document.querySelector('#jobList [data-job=date]'); return i ? { value: i.value, max: i.max, x: !!document.querySelector('#jobList .job-x') } : null;")
    check("“record” opens a day to type, today at the latest, with a way to leave", typed and typed["value"] == first["today"] and typed["max"] == first["today"] and typed["x"], typed)
    page.locator("#jobList .job-x").click(); wait(300)
    left = js("return { input: !!document.querySelector('#jobList [data-job=date]'), undo: S.undo.length };")
    check("× leaves it without recording", not left["input"] and left["undo"] == one["undo"], left)
    page.locator('#jobList li[data-job="harden"] [data-job="tick"]').click(); wait(300)
    page.locator('#jobList [data-job="save"]').click(); wait(800)
    pan = js(f"const p = S.engine.planting({json.dumps(one['id'])}), li = document.querySelector('#jobList li[data-job=harden]'); return {{ done: p.done && p.done.harden, date: p.date, state: li.dataset.state, text: li.textContent, toast: (document.querySelector('.toast') || {{}}).textContent || '', next: document.querySelector('#jobList li[data-job=field]').textContent }};")
    check("recorded there, late: the job is done, the planting goes out as many days later, and both are said", pan["done"] == first["today"] and pan["date"] == plus(one["date"], one["late"]) and pan["state"] == "done" and "Hardened off" in pan["text"] and f"{one['late']} d late" in pan["text"] and "later" in pan["toast"] and f"{one['late']} d later" in pan["next"], pan)
    page.screenshot(path=str(shots / f"panel-jobs-{WIDTH}.png"))
    clip = js("const p = document.getElementById('inspectorBody'); return { wide: p.scrollWidth > p.clientWidth + 1, spill: [...document.querySelectorAll('#jobList li')].filter(li => li.scrollWidth > li.clientWidth + 1).map(li => li.textContent) };")
    check("the schedule fits the panel", not clip["wide"] and clip["spill"] == [], clip)
    page.locator('#jobList li[data-job="harden"] [data-job="back"]').click(); wait(700)
    unp = js(f"const p = S.engine.planting({json.dumps(one['id'])}); return {{ done: !!(p.done && p.done.harden), date: p.date }};")
    check("“take back” there clears it and returns the planting", not unp["done"] and unp["date"] == one["date"], unp)

    # ── what survives a reload ──
    js(f"A.recordWork([{{ id: {json.dumps(one['id'])}, kind: 'harden' }}], {{ date: A.today() }})"); wait(900)
    page.reload(); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); wait(900)
    kept2 = js(f"const p = S.engine.planting({json.dumps(one['id'])}); return {{ done: p.done && p.done.harden, date: p.date, pushed: !!W.pushed(p, 'harden'), late: W.steps(S.engine, p).find(s => s.kind === 'harden').late }};")
    check("a recorded job, its push and how late it was are in the saved plan", kept2["done"] == first["today"] and kept2["date"] == plus(one["date"], one["late"]) and kept2["pushed"] and kept2["late"] == one["late"], kept2)
    page.click('[data-view-btn="sow"]'); wait(600)

    # ── the printed sheet ──
    sheet = js("""const s = V.sheet(), f = V.figures().list.filter(l => l.week === now), j = V.jobs().filter(l => l.week === now && !l.passed);
      const tables = s.querySelectorAll('table'), rows = tables[0].querySelectorAll('tbody tr:not(.wkp-head):not(.wkp-half)');
      return { h1: s.querySelector('h1').textContent, rows: rows.length, want: f.length + j.length, boxes: [...rows].filter(r => /[☐☑]/.test(r.querySelector('.wkp-box').textContent)).length, done: [...rows].filter(r => r.querySelector('.wkp-box').textContent === '☑').length,
        wantDone: f.filter(l => l.state === 'done').length + j.filter(l => l.state === 'done').length, heads: [...tables[0].querySelectorAll('tr.wkp-head')].map(r => r.textContent), earlier: !!s.querySelector('h2'), cols: [...tables[0].querySelectorAll('thead th')].map(t => t.textContent) };""")
    check("the sheet is the week: a row and a box for every job, the done ones ticked, a column to write the day", sheet["rows"] == sheet["want"] and sheet["boxes"] == sheet["rows"] and sheet["done"] == sheet["wantDone"] and sheet["cols"][-1] == "Done on" and sheet["h1"].startswith("Week of May 3"), sheet)
    check("it is set out by job, and lists what was left from earlier weeks", "Harden off" in sheet["heads"] and "Plant out" in sheet["heads"] and any(h.startswith("Sow") for h in sheet["heads"]) and not sheet["earlier"], sheet["heads"])
    page.locator(".sw-earlier summary").click(); wait(900)
    sheet2 = js("const s = V.sheet(), t = s.querySelectorAll('table'); return { h2: (s.querySelector('h2') || {}).textContent, rows: t.length > 1 ? t[1].querySelectorAll('tbody tr:not(.wkp-head):not(.wkp-half)').length : 0, want: V.figures().list.filter(l => l.week < now && l.state !== 'done').length + V.jobs().filter(l => l.week < now && l.state !== 'done').length };")
    check("with the earlier jobs open on the page they are on the sheet too: what is seen is what is printed", sheet2["h2"] == "Not recorded from earlier weeks" and sheet2["rows"] == sheet2["want"] and sheet2["want"] > 0, sheet2)
    page.locator(".sw-earlier summary").click(); wait(500)
    page.evaluate("(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; })()")
    page.click("#wkPrint"); wait(200)
    pr = js("return { printed: window.__printed, cls: document.body.classList.contains('printing'), sheet: !!document.querySelector('#printSheet .wkp') };")
    page.emulate_media(media="print"); wait(150)
    shown = js("return { sheet: getComputedStyle($('printSheet')).display, top: getComputedStyle(document.querySelector('header.top')).display, work: getComputedStyle(document.querySelector('main.work')).display, space: getComputedStyle(document.querySelector('#printSheet .wkp')).whiteSpace };")
    page.screenshot(path=str(shots / "week-print.png"), full_page=True)
    page.emulate_media(media="screen"); wait(1700)
    check("Print the week sends that sheet, and only that sheet, to the printer", pr["printed"] == 1 and pr["cls"] and pr["sheet"] and shown["sheet"] == "block" and shown["top"] == "none" and shown["work"] == "none" and shown["space"] == "normal", [pr, shown])
    check("and the page is itself again afterwards", not js("return document.body.classList.contains('printing');"))
    ctx.close()

    # ── a phone: the week is the whole page ──
    ctx, page = open_page(390, 844)
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    wait = lambda ms=350: page.wait_for_timeout(ms)
    ph = js("""const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
      const rows = [...document.querySelectorAll('.view-sow tbody tr[data-line]')], boxes = [...document.querySelectorAll('.view-sow tbody tr[data-line] input[type=checkbox]')].map(b => b.getBoundingClientRect());
      return { phone: document.body.classList.contains('phone'), view: S.view, nav: vis(document.querySelector('nav.views')), lib: vis(document.querySelector('.library')), insp: vis(document.querySelector('.inspector')), season: vis(document.querySelector('.season')),
        week: vis(document.querySelector('.view-sow')), sideways: document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1,
        rows: rows.length, want: V.figures().list.filter(l => l.week === now).length + V.jobs().filter(l => l.week === now && !l.passed).length, grid: rows.every(r => getComputedStyle(r).display === 'grid'), wideRows: rows.filter(r => r.getBoundingClientRect().right > innerWidth + 1 || [...r.children].some(c => c.getBoundingClientRect().right > innerWidth + 1)).length,
        box: Math.min(...boxes.map(b => Math.min(b.width, b.height))), save: vis($('saveState')), backup: vis($('dataBtn')), full: vis($('wkFull')), undo: vis($('undoBtn')), print: !!$('wkPrint'), bench: !!document.querySelector('.view-sow .bn'),
        top: document.querySelector('header.top').getBoundingClientRect().height, tiles: [...document.querySelectorAll('.sw-stats .tr-stat')].filter(vis).length, stepper: document.querySelector('.tr-stepper .icon-btn').getBoundingClientRect().width };""")
    check("on a phone the planner opens on the week, and the week is all there is: no map, no library, no other views", ph["phone"] and ph["view"] == "sow" and ph["week"] and not ph["nav"] and not ph["lib"] and not ph["insp"] and not ph["season"], ph)
    check("every job of the week is there, each a block that fits the screen, with nothing running off sideways", ph["rows"] == ph["want"] and ph["rows"] > 0 and ph["grid"] and ph["wideRows"] == 0 and not ph["sideways"], ph)
    check("the boxes and the week buttons are big enough for a thumb", ph["box"] >= 24 and ph["stepper"] >= 40, ph)
    check("the header keeps what matters in one line: undo, whether it is saved, Backup (where Cloud sync is), and the way to the full planner", ph["save"] and ph["backup"] and ph["full"] and ph["undo"] and ph["top"] <= 60, ph)
    check("three tiles, and no bench chart or print button to scroll past", ph["tiles"] == 3 and not ph["bench"] and not ph["print"], ph)
    page.screenshot(path=str(shots / "phone-week.png"))
    pk = js("const l = V.jobs().find(l => l.week === now && l.state === 'open' && l.section === 'harden' && l.date < A.today()); return { key: l.key, ids: l.members.map(m => m.p.id), dates: l.members.map(m => m.p.date), late: E.dayDiff(E.s2d(A.today()), E.s2d(l.date)) };")
    r0 = page.locator(f'table.sw tbody tr[data-line={json.dumps(pk["key"])}]'); r0.scroll_into_view_if_needed(); r0.locator("td.sw-what").click(); wait(500)
    pb = js("const b = document.querySelector('.sw-record'), r = b.getBoundingClientRect(), k = $('swRecord').getBoundingClientRect(); return { pos: getComputedStyle(b).position, in: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.top >= 0, button: k.height, follow: !!$('wkFollow'), date: b.querySelector('input[type=date]').getBoundingClientRect().height };")
    check("a tap on a job ticks it, and the bar to record it stays at the bottom of the screen, whole, with a button to hit", pb["pos"] == "fixed" and pb["in"] and pb["button"] >= 44 and pb["follow"] and pb["date"] >= 40, pb)
    page.screenshot(path=str(shots / "phone-ticked.png"))
    page.click("#swRecord"); wait(900)
    pd = js(f"const ps = {json.dumps(pk['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.harden === A.today()), dates: ps.map(p => p.date), toast: document.querySelector('.toast').getBoundingClientRect().right <= innerWidth + 1 }};")
    check("recorded from the phone like anywhere else", pd["done"] and pd["dates"] == [js(f"return E.d2s(E.addDays(E.s2d('{d}'), {pk['late']}));") for d in pk["dates"]] and pd["toast"], pd)
    wt = js("const b = [...document.querySelectorAll('.view-sow td.sw-where .linkish')][0], was = E.d2s(S.date); b.click(); return { view: S.view, same: E.d2s(S.date) === was, sel: S.sel ? S.sel.type : null };")
    check("a tap on where a job is does not wander off to the map, change the week or select anything", wt["view"] == "sow" and wt["same"] and wt["sel"] is None, wt)
    page.locator(".tr-stepper .icon-btn").nth(1).click(); wait(500)
    nx = js("return { week: T.monday(E.d2s(S.date)), today: !!$('wkToday') };")
    check("the next week is one tap away, and “This week” comes back", nx["week"].endswith("-05-10") and nx["today"], nx)
    page.click("#wkToday"); wait(400)
    page.click("#dataBtn"); wait(300)
    mn = js("const m = $('dataMenu'), r = m.getBoundingClientRect(), s = $('syncBtn').getBoundingClientRect(); return { open: !m.hidden, in: r.left >= 0 && r.right <= innerWidth + 1, sync: s.width > 0 && s.bottom <= innerHeight };")
    check("Backup opens within the screen, with Cloud sync in reach", mn["open"] and mn["in"] and mn["sync"], mn)
    page.screenshot(path=str(shots / "phone-menu.png"))
    page.keyboard.press("Escape"); wait(200)
    page.click("#wkFull"); wait(600)
    fl = js("return { phone: document.body.classList.contains('phone'), nav: getComputedStyle(document.querySelector('nav.views')).display };")
    check("“Full planner” leaves the phone page for the visit", not fl["phone"] and fl["nav"] != "none", fl)
    ctx.close()
    # a wide window made narrow, and wide again
    ctx, page = open_page(1280, 800)
    page.set_viewport_size({"width": 600, "height": 800}); page.wait_for_timeout(500)
    a = page.evaluate("({ phone: document.body.classList.contains('phone'), view: LRFApp.state.view })")
    page.set_viewport_size({"width": 1280, "height": 800}); page.wait_for_timeout(500)
    b = page.evaluate("({ phone: document.body.classList.contains('phone'), nav: getComputedStyle(document.querySelector('nav.views')).display })")
    check("a window made narrow becomes the week; made wide again, it is the planner", a["phone"] and a["view"] == "sow" and not b["phone"] and b["nav"] != "none", [a, b])
    ctx.close()
    check("no error was written to the console", errors == [], errors[:5])
    browser.close()
finish()
