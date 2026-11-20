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
    row = lambda key: page.locator(f'.tk-row[data-line={json.dumps(key)}]')
    toast = lambda: js("return (document.querySelector('.toast') || {}).textContent || '';")
    plus = lambda iso, k: js(f"return E.d2s(E.addDays(E.s2d('{iso}'), {k}));")
    def more():   # open what is folded of the late tasks, in both lists
        for i in range(page.locator(".tk-more").count()): page.locator(".tk-more").first.click(); wait(250)
    def unfold():
        for i in range(page.locator('.tk-fold[aria-expanded="false"]').count()): page.locator('.tk-fold[aria-expanded="false"]').first.click(); wait(120)
        wait(400)
    # a tick a week or more ahead of its day asks first (Tasks part 2): the check answers yes, as the grower would
    def tick(key): row(key).locator(".tk-tick").scroll_into_view_if_needed(); row(key).locator(".tk-tick").click(); page.wait_for_timeout(250); _ah = page.locator('[data-hook="tasks-ahead-yes"]'); _ah.first.click() if _ah.count() and _ah.first.is_visible() else None; wait(500)
    def pick(iso): page.click(f'#tkPop [data-pick="{iso}"]'); wait(1500)
    popup = lambda: js("""const p = $('tkPop'); return p.hidden ? null : { head: p.querySelector('strong').textContent, about: p.querySelector('small').textContent, quick: (p.querySelector('.tk-quick') || {}).textContent || '', hint: $('tkHint').textContent,
      due: [...p.querySelectorAll('.tk-cell.due')].map(c => c.dataset.pick), cur: [...p.querySelectorAll('.tk-cell.cur')].map(c => [c.textContent, c.disabled]), picks: [...p.querySelectorAll('.tk-cell:not([disabled])')].map(c => c.dataset.pick),
      box: (r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }))(p.getBoundingClientRect()), pending: [...document.querySelectorAll('.tk-row.pending')].map(r => r.dataset.line), mode: V.where().pop };""")

    # ── the view ──
    page.click('[data-view-btn="sow"]'); wait(700)
    folded = js("""const all = V.tasks(), today = A.today(), open = t => t.state === 'open' || t.state === 'part', late = half => all.filter(t => t.half === half && open(t) && t.due < today);
      return [...document.querySelectorAll('.view-sow .tk-list')].map(l => ({ half: l.dataset.half, late: late(l.dataset.half).length, oldest: (late(l.dataset.half)[0] || {}).due, more: (l.querySelector('.tk-more') || {}).textContent || '', shown: l.querySelectorAll('.tk-put.late').length,
        said: (l.querySelector('.tk-sec.late .tk-sec-n') || {}).textContent || '', dues: [...l.querySelectorAll('.tk-row')].filter(r => r.querySelector('.tk-put.late')).map(r => r.dataset.due) }));""")
    more()
    first = js("""const all = V.tasks(), today = A.today(), open = t => t.state === 'open' || t.state === 'part', NUR = ['plugs', 'rockwool', 'live', 'potup', 'harden'], FLD = ['direct', 'plant', 'move'], ORD = [...NUR, ...FLD];
      const lists = [...document.querySelectorAll('.view-sow .tk-list')].map(l => ({ half: l.dataset.half, rows: [...l.querySelectorAll('.tk-row')].map(r => [r.dataset.due, ORD.indexOf(r.dataset.kind), (l.dataset.half === 'nursery' ? NUR : FLD).includes(r.dataset.kind)]), count: l.querySelector('.tk-count').textContent, ring: !!l.querySelector('header .tk-ring'),
        want: all.filter(t => t.half === l.dataset.half && open(t) && t.due <= today).length, lates: [...l.querySelectorAll('.tk-put.late')].map(b => b.textContent),
        secs: [...l.querySelectorAll('.tk-sec')].map(s => { let n = 0, e = s.nextElementSibling; while (e && !e.classList.contains('tk-sec') && !e.classList.contains('tk-fold')) { if (e.classList.contains('tk-row')) n++; e = e.nextElementSibling; } return [s.querySelector('.tk-sec-name').textContent, s.querySelector('.tk-sec-n').textContent, n]; }) }));
      return { today: A.today(), now, nav: document.querySelector('[data-view-btn="sow"]').textContent, pressed: document.querySelector('[data-view-btn="sow"]').getAttribute('aria-pressed'), h2: $('wkTitle').textContent, range: $('tkRange').textContent, where: V.where(),
        rows: document.querySelectorAll('.view-sow .tk-row').length, want: all.filter(t => open(t) && t.due <= today).length, late: all.filter(t => open(t) && t.due < today).length, lists,
        days: [...document.querySelectorAll('#tkDays .tk-day')].map(b => [b.dataset.day, b.getAttribute('aria-pressed'), b.querySelector('em').textContent, b.classList.contains('now'), !!b.querySelector('.tk-ring')]), dark: getComputedStyle(document.body).backgroundColor,
        sideways: document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1, print: !!$('wkPrint'), bench: !!document.querySelector('.view-sow .bn'), line: !!document.querySelector('.view-sow #bnLine') };""")
    check("the page believes it is May 5 of the plan's year, and the week is that week", first["today"].endswith("-05-05") and first["now"].endswith("-05-03") and first["where"]["day"] == first["today"] and first["where"]["week"] == first["now"], first)
    check("the view is called Tasks, opens on today and says so", first["nav"] == "Tasks" and first["pressed"] == "true" and first["h2"] == "Today", first)
    check("today lists what is due today and what is late, a row each", first["want"] > 0 and first["rows"] == first["want"] and all(len(l["rows"]) == l["want"] for l in first["lists"]), first)
    check("under a line for each group, Late and then Today, each saying how many it holds", all([s[0] for s in l["secs"]] in (["Late", "Today"], ["Late"], ["Today"]) and all(int(s[1].split(" ")[0].replace(",", "")) == s[2] for s in l["secs"]) for l in first["lists"]) and any(len(l["secs"]) == 2 for l in first["lists"]), [l["secs"] for l in first["lists"]])
    check("two lists: the nursery's work (seedling trays, tower seedlings, live trays, pot up, harden off) and the field's (sown in the ground, plant out, move out), each by day and then by kind",
          [l["half"] for l in first["lists"]] == ["nursery", "field"] and all(all(r[2] for r in l["rows"]) for l in first["lists"]) and all([r[:2] for r in l["rows"]] == sorted([r[:2] for r in l["rows"]]) for l in first["lists"]), [l["half"] for l in first["lists"]])
    check("the head says the day and what is to do, the week's cells count each day, and each list counts what is done of it", first["range"] == f"Wednesday, May 5 · {first['want']} to do" and [d for d in first["days"] if d[3]] == [[first["today"], "true", f"{first['want']:,}", True, True]]
          and all(l["count"] == f"0 of {l['want']}" and l["ring"] for l in first["lists"]), first)
    check("what was planned before today and never recorded is late, on today's list: a long run of it is folded to its latest six, with one line that opens the rest", first["late"] > 0 and any(f["late"] > 12 for f in folded)
          and all((f["shown"] == 6 and f["more"].startswith(f"{f['late'] - 6:,} more, back to ") and f["said"].startswith(f"{f['late']:,}") and f["dues"] == sorted(f["dues"]) and f["dues"][0] > f["oldest"]) if f["late"] > 12 else (f["shown"] == f["late"] and not f["more"]) for f in folded)
          and all(len(l["lates"]) == next(f["late"] for f in folded if f["half"] == l["half"]) and all(x.endswith(" late") for x in l["lates"]) for l in first["lists"]), folded)
    check("no sideways scroll; a print button; below, one line of bench room and not the chart (0.31: the chart is in the Nursery)", not first["sideways"] and first["print"] and not first["bench"] and first["line"], first)
    fit = js("""const bad = [];
      for (const e of document.querySelectorAll('.tk-title, .tk-sub, .tk-sec-name, .tk-sec-n, .tk-put, .tk-flag, .tk-count, #wkPrint, #tkWeek, #tkDate, .tk-day em')) { const c = e.closest('.tk-list, .tk-week, .tk-top').getBoundingClientRect(), r = e.getBoundingClientRect(); if (r.right > c.right + 1 || r.left < c.left - 1 || e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') bad.push(e.textContent); }
      for (const m of document.querySelectorAll('.tk-main')) { const w = m.querySelector('.tk-words').getBoundingClientRect(), p = m.querySelector('.tk-put, .tk-when').getBoundingClientRect(); if (w.right > p.left + 1) bad.push(m.textContent); }
      return bad;""")
    check("no label is clipped and no figure spills out of its column", fit == [], fit[:6])
    page.screenshot(path=str(shots / f"week-{WIDTH}.png"))

    # ── a task done late: asked its day, told what that would do, then one step ──
    pk = js("""const j = V.jobs().filter(l => l.week === now && l.state === 'open'), today = A.today();
      const hard = j.find(l => l.section === 'harden' && l.date < today && l.date >= now), r = hard.members[0].r;
      return { key: hard.key, ids: hard.members.map(m => m.p.id), dates: hard.members.map(m => m.p.date), due: hard.date, late: E.dayDiff(E.s2d(today), E.s2d(hard.date)), first: E.d2s(r.first), undo: S.undo.length, name: hard.name };""")
    snaps0 = ajs("return (await A.snapshots()).rows.filter(s => /^Plan of record/.test(s.name)).length;")
    tick(pk["key"])
    pop = popup(); n = len(pk["ids"]); late = pk["late"]
    rowbox = row(pk["key"]).bounding_box(); listbox = row(pk["key"]).locator("xpath=ancestor::section[contains(@class, \"tk-list\")]").bounding_box()
    check("a tick on a late task opens the calendar, beside its list so the row stays in view: “When was it done?”, Today first, the day it was due circled",
          pop and pop["head"] == "When was it done?" and pk["name"] in pop["about"] and pop["quick"].startswith("Today") and pop["due"] == [pk["due"]] and pop["pending"] == [pk["key"]] and pop["mode"] == "done"
          and (pop["box"]["left"] >= listbox["x"] + listbox["width"] or pop["box"]["right"] <= listbox["x"]) and pop["box"]["left"] >= 0 and pop["box"]["right"] <= WIDTH and 0 <= rowbox["y"] and rowbox["y"] + rowbox["height"] <= 900, {"pop": pop, "row": rowbox, "list": listbox})
    page.hover("#tkPop .tk-quick button"); wait(250); hint = page.inner_text("#tkHint")
    check("before anything is recorded the calendar says what a day would do: how late, and where planting out goes", f"{late} day{'s' if late != 1 else ''} late" in hint and f"planting out {js('return LRFUI.day(E.s2d(' + json.dumps(pk['dates'][0]) + '))')} → " in hint, hint)
    page.screenshot(path=str(shots / f"week-follow-{WIDTH}.png"))
    still = js(f"return {{ dates: {json.dumps(pk['ids'])}.map(id => S.engine.planting(id).date), undo: S.undo.length }};")
    check("looking at what it would do changes nothing", still["dates"] == pk["dates"] and still["undo"] == pk["undo"], still)
    pick(first["today"])
    unfold()
    after = ajs(f"""const ids = {json.dumps(pk['ids'])}, ps = ids.map(id => S.engine.planting(id)), today = A.today(), r = S.engine.calc(ps[0]);
      const line = V.jobs().find(l => l.section === 'harden' && l.members.some(m => m.p.id === ids[0])), out = V.jobs().find(l => l.section === 'plant' && l.members.some(m => m.p.id === ids[0]));
      const tr = [...document.querySelectorAll('.tk-fold-body .tk-row')].find(r => r.dataset.line === line.key), lineOpen = [...document.querySelectorAll('.tk-row:not(.done)')][0];
      return {{ done: ps.every(p => p.done && p.done.harden === today), dates: ps.map(p => p.date), undo: S.undo.length, label: S.undo[S.undo.length - 1].label, first: E.d2s(r.first), toast: (document.querySelector('.toast') || {{}}).textContent || '', key: line.key,
        state: line.state, rowState: tr && tr.dataset.state, when: tr ? tr.querySelector('.tk-when').textContent : '', struck: tr ? getComputedStyle(tr.querySelector('.tk-title')).backgroundSize : '', tall: tr ? tr.getBoundingClientRect().height : 0, openTall: lineOpen.getBoundingClientRect().height, tick: tr ? tr.querySelector('.tk-tick').getAttribute('aria-checked') : '', fold: (document.querySelector('.tk-list[data-half=nursery] .tk-fold') || {{}}).textContent || '',
        count: document.querySelector('.tk-list[data-half=nursery] .tk-count').textContent, pop: $('tkPop').hidden, outDate: out.date, outPushed: out.pushed.length, snaps: (await A.snapshots()).rows.filter(s => /^Plan of record/.test(s.name)).map(s => [s.name, s.auto, s.plantings]) }};""")
    check("one press dates the job on the real day and moves each planting as many days later, as one step", after["done"] and after["dates"] == [plus(d, late) for d in pk["dates"]] and after["undo"] == pk["undo"] + 1 and "1 task recorded" in after["label"] and after["pop"], after)
    check("the harvest follows", after["first"] == plus(pk["first"], late), after)
    check("the toast says what was done, how late, what moved, and offers Undo", " hardened off today" in after["toast"] and f"{late} day{'s' if late != 1 else ''} late" in after["toast"] and "planting out " in after["toast"] and "first harvest " in after["toast"] and "→" in after["toast"] and after["toast"].endswith("Undo"), after["toast"])
    check("the task reads as done: under “Completed today”, ticked and struck through, and its list counts it", after["state"] == "done" and after["rowState"] == "done" and after["tick"] == "true" and after["when"] == "Done" and after["struck"].startswith("100%") and "Completed today 1" in after["fold"] and after["count"].startswith("1 of "), after)
    check("a done row is no taller than a row still to do", 0 < after["tall"] <= after["openTall"] + 24, [after["tall"], after["openTall"]])
    check("planting out is listed on its new day", after["outDate"] == plus(pk["dates"][0], late) and after["outPushed"] >= 1, after)
    check("the plan as it stood before the first recorded work is kept as a named snapshot, once", snaps0 == 0 and len(after["snaps"]) == 1 and str(2027) in after["snaps"][0][0] and not after["snaps"][0][1] and "plan of record" in after["toast"], after["snaps"])
    page.screenshot(path=str(shots / f"week-recorded-{WIDTH}.png"))
    # the pushed plant-out line says why it is not where it was
    tag = js(f"""const out = V.jobs().find(l => l.section === 'plant' && l.members.some(m => m.p.id === {json.dumps(pk['ids'][0])})); V.show(out.date); return out.key;"""); wait(500)
    tagText = js(f"const tr = [...document.querySelectorAll('.tk-row')].find(r => r.dataset.line === {json.dumps(tag)}); return tr ? tr.querySelector('.tk-sub').textContent : null;")
    check("where the planting now goes out, its row says it is later than first planned", tagText is not None and f"{late} day{'s' if late != 1 else ''} later than first planned" in tagText, tagText)
    js("V.show(A.today())"); wait(400); unfold()

    # take back: the day is cleared and the plantings return
    row(after["key"]).locator(".tk-tick").click(); page.wait_for_timeout(250); _ah = page.locator('[data-hook="tasks-ahead-yes"]'); _ah.first.click() if _ah.count() and _ah.first.is_visible() else None; wait(700)
    back = js(f"const ps = {json.dumps(pk['ids'])}.map(id => S.engine.planting(id)); return {{ cleared: ps.every(p => !(p.done && p.done.harden)), dates: ps.map(p => p.date), undo: S.undo.length, toast: (document.querySelector('.toast') || {{}}).textContent || '' }};")
    check("unticking it clears the day and puts the plantings back where they were first planned, in one step", back["cleared"] and back["dates"] == pk["dates"] and back["undo"] == pk["undo"] + 2 and "taken back" in back["toast"] and "first planned" in back["toast"], back)
    page.keyboard.press("Control+z"); wait(500); page.keyboard.press("Control+z"); wait(500)
    undone = js(f"const ps = {json.dumps(pk['ids'])}.map(id => S.engine.planting(id)); return {{ clean: ps.every(p => !p.done), dates: ps.map(p => p.date), undo: S.undo.length }};")
    check("undo twice returns to before anything was recorded", undone["clean"] and undone["dates"] == pk["dates"] and undone["undo"] == pk["undo"], undone)

    # the same job, done on the day it was due
    more(); tick(pk["key"])
    page.hover(f'#tkPop [data-pick="{pk["due"]}"]'); wait(250); onday = page.inner_text("#tkHint")
    check("the day it was due is offered, and says nothing moves", "on its day" in onday and "nothing moves" in onday, onday)
    pick(pk["due"]); wait(1200)   # the plan of record is written after the record: give a second one time to land before counting
    kept = ajs(f"const ps = {json.dumps(pk['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.harden === '{pk['due']}'), dates: ps.map(p => p.date), toast: (document.querySelector('.toast') || {{}}).textContent || '', snaps: (await A.snapshots()).rows.filter(s => /^Plan of record/.test(s.name)).length, today: [...document.querySelectorAll('.tk-row')].some(r => r.dataset.line === {json.dumps(pk['key'])}) }};")
    check("then the job is dated on that day, nothing moves, and it leaves today's list for the day it was done", kept["done"] and kept["dates"] == pk["dates"] and "→" not in kept["toast"] and "later" not in kept["toast"] and not kept["today"], kept)
    check("the plan of record is not taken a second time", kept["snaps"] == 1, kept)
    page.keyboard.press("Control+z"); wait(500)

    # ── early work pulls nothing; planting out is a fact the harvest is counted from ──
    ahead = js("""const j = V.jobs().filter(l => l.week === now && l.state === 'open'), today = A.today();
      const h = j.find(l => l.section === 'harden' && l.date > today), pl = V.jobs().find(l => l.state === 'open' && l.section === 'plant' && !l.stock && l.date > today && l.members.every(m => m.r.plannedSow && W.steps(S.engine, m.p).some(s => s.kind === 'harden')));
      return { h: h && { key: h.key, date: h.date, ids: h.members.map(m => m.p.id), dates: h.members.map(m => m.p.date) }, pl: pl && { key: pl.key, date: pl.date, ids: pl.members.map(m => m.p.id), dates: pl.members.map(m => m.p.date), firsts: pl.members.map(m => E.d2s(m.r.first)), early: E.dayDiff(E.s2d(pl.date), E.s2d(today)) } };""")
    if ahead["h"]:
        js(f"V.show('{ahead['h']['date']}')"); wait(450)
        tick(ahead["h"]["key"]); wait(1100)
        e = js(f"const ps = {json.dumps(ahead['h']['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.harden === A.today()), dates: ps.map(p => p.date), pop: $('tkPop').hidden, toast: (document.querySelector('.toast') || {{}}).textContent || '' }};")
        check("a task of a later day ticked today is recorded at once, with no question, and moves nothing", e["pop"] and e["done"] and e["dates"] == ahead["h"]["dates"] and "early" in e["toast"] and "nothing else moves" in e["toast"], e)
        page.keyboard.press("Control+z"); wait(500)
    else: check("a task of a later day ticked today is recorded at once, with no question, and moves nothing (no such job this week)", True)
    check("the week has, after today, a job of each kind to try early: hardening off, and planting out what was hardened off", bool(ahead["h"]) and bool(ahead["pl"]), ahead)
    if ahead["pl"]:
        js(f"V.show('{ahead['pl']['date']}')"); wait(500)   # its own day, which may be in a later week
        tick(ahead["pl"]["key"]); wait(1100)
        e = js(f"const ps = {json.dumps(ahead['pl']['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.field === A.today()), dates: ps.map(p => p.date), firsts: ps.map(p => E.d2s(S.engine.calc(p).first)), use: ps.every(p => !((p.workflow || {{}}).seedUse || []).length), sow: ps.map(p => W.steps(S.engine, p).find(s => s.kind === 'sow').passed) }};")
        k = ahead["pl"]["early"]
        check("planting out recorded early keeps the plan's day as the plan and brings the harvest forward by the engine's own count", e["done"] and e["dates"] == ahead["pl"]["dates"] and e["firsts"] == [plus(f, -k) for f in ahead["pl"]["firsts"]] and e["use"], e)
        check("its sowing, never recorded, is passed over: not waiting, not assumed", all(e["sow"]), e)
        gone = js(f"const id = {json.dumps(ahead['pl']['ids'][0])}; return {{ waiting: V.figures().list.filter(l => l.state !== 'done' && l.members.some(m => m.p.id === id && !m.s.done && !m.s.sown)).length, harden: V.jobs().filter(l => l.section === 'harden' && l.open.some(m => m.p.id === id)).length, tasks: V.tasks().filter(t => (t.state === 'open' || t.state === 'part') && t.line.open.some(m => m.p.id === id)).length }};")
        check("so neither its sowing nor its hardening off is listed as still to do", gone["waiting"] == 0 and gone["harden"] == 0 and gone["tasks"] == 0, gone)
        page.keyboard.press("Control+z"); wait(500)
    js("V.show(A.today())"); wait(400); more()

    # ── a sowing and what is planted, each on the day picked for it ──
    mix = js("""const f = V.figures(), j = V.jobs(), today = A.today();
      const sow = f.list.find(l => l.week === now && l.state === 'open' && l.kind === 'plugs' && l.date < today) || f.list.find(l => l.week === now && l.state === 'open' && l.kind !== 'live' && l.date < today);
      const bulb = j.find(l => l.week === now && l.state === 'open' && l.stock && l.date < today), plant = j.find(l => l.week === now && l.state === 'open' && l.section === 'plant' && !l.stock && l.date < today);
      return { sow: sow && { key: sow.key, ids: sow.members.map(m => m.p.id), kind: sow.kind, date: sow.date, estimate: sow.estimate, dates: sow.members.map(m => m.p.date) }, bulb: bulb && { key: bulb.key, ids: bulb.members.map(m => m.p.id), unit: bulb.stock.unit, estimate: bulb.estimate, date: bulb.date },
        plant: plant && { key: plant.key, ids: plant.members.map(m => m.p.id), date: plant.date }, undo: S.undo.length };""")
    other = mix["bulb"] or mix["plant"]
    tick(mix["sow"]["key"]); sowpop = popup(); pick(mix["sow"]["date"]); said1 = toast()
    check("a sowing ticked is said to be sown, on its day, with the seed it took", sowpop and sowpop["head"] == "When was it done?" and " sown " in said1 and ("off stock" in said1 or "not from a counted lot" in said1) and "late" not in said1, [sowpop, said1])
    tick(other["key"]); pick(other["date"]); said2 = toast()
    check("what is planted is said to be planted out, on its day", " planted out " in said2 and "late" not in said2, said2)
    two = js(f"""const sow = {json.dumps(mix['sow']['ids'])}.map(id => S.engine.planting(id)), oth = {json.dumps(other['ids'])}.map(id => S.engine.planting(id)), use = p => ((p.workflow || {{}}).seedUse || []).reduce((n, u) => n + u.quantity, 0);
      return {{ sown: sow.every(p => p.done && (p.done.sow === '{mix['sow']['date']}' || p.done.field === '{mix['sow']['date']}')), planted: oth.every(p => p.done && p.done.field === '{other['date']}'), seed: sow.map(use).reduce((a, b) => a + b, 0), units: oth.map(use).reduce((a, b) => a + b, 0), undo: S.undo.length, labels: S.undo.slice(-2).map(s => s.label), dates: sow.map(p => p.date) }};""")
    check("each is recorded on the day picked for it in the calendar, a step each", two["sown"] and two["planted"] and two["undo"] == mix["undo"] + 2 and f"{len(mix['sow']['ids'])} sowing" in two["labels"][0] and "recorded" in two["labels"][1], two)
    check("the seed the sowing used is recorded as it always was", two["seed"] == mix["sow"]["estimate"], [two["seed"], mix["sow"]["estimate"]])
    if mix["bulb"]: check("what was planted and not sown records what it used, in its own unit", two["units"] == mix["bulb"]["estimate"], [two["units"], mix["bulb"]])
    page.keyboard.press("Control+z"); wait(600); page.keyboard.press("Control+z"); wait(600)

    # ── a day after today is never a record; a day before today is never a plan ──
    more(); tick(other["key"]); fut = popup()
    check("a task cannot be recorded on a day after today: the calendar offers none", fut and fut["picks"] and max(fut["picks"]) == first["today"] and other["date"] in fut["picks"], fut)
    page.keyboard.press("Escape"); wait(300)
    esc = js("return { pop: $('tkPop').hidden, scrim: $('tkScrim').hidden, pending: document.querySelectorAll('.tk-row.pending').length, undo: S.undo.length };")
    check("Escape leaves the calendar, and nothing is recorded", esc["pop"] and esc["scrim"] and esc["pending"] == 0 and esc["undo"] == mix["undo"], esc)
    if not esc["pop"]: js("$('tkPop').querySelector('[data-close]').click()"); wait(300)
    row(mix["sow"]["key"]).locator(".tk-put").click(); wait(500); put = popup()
    check("a task put off is offered today and the days after it: none before, and not the day it stands on", put and put["head"] == "Delay it to" and put["mode"] == "delay" and put["quick"].startswith("Tomorrow") and min(put["picks"]) == first["today"] and mix["sow"]["date"] not in put["picks"], put)
    page.click("#tkPop [data-close]"); wait(300)
    cleared = js("return { pop: $('tkPop').hidden, scrim: $('tkScrim').hidden, pending: document.querySelectorAll('.tk-row.pending').length, undo: S.undo.length };")
    check("× leaves the calendar without doing anything", cleared["pop"] and cleared["scrim"] and cleared["pending"] == 0 and cleared["undo"] == mix["undo"], cleared)

    # ── late, in full ──
    earl = js("""const today = A.today(), late = V.tasks().filter(t => (t.state === 'open' || t.state === 'part') && t.due < today), rows = [...document.querySelectorAll('.tk-row')].filter(r => r.querySelector('.tk-put.late'));
      return { rows: rows.length, want: late.length, kinds: [...new Set(rows.map(r => r.dataset.kind))], said: rows.every(r => r.querySelector('.tk-put.late').textContent === E.dayDiff(E.s2d(today), E.s2d(r.dataset.due)) + (E.dayDiff(E.s2d(today), E.s2d(r.dataset.due)) === 1 ? ' day late' : ' days late')), more: document.querySelectorAll('.tk-more').length };""")
    check("opened, the late tasks are all there: every sowing and every other job not recorded, each saying how many days late it is", earl["rows"] == earl["want"] and earl["want"] > 12 and "harden" in earl["kinds"] and "plant" in earl["kinds"] and earl["said"] and earl["more"] == 0, earl)

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
    pan = js(f"""const p = S.engine.planting({json.dumps(one['id'])}), li = document.querySelector('#jobList li[data-job=harden]');
      const field = document.querySelector('#jobList li[data-job=field]');
      return {{ done: p.done && p.done.harden, date: p.date, state: li.dataset.state, text: li.textContent,
        toast: (document.querySelector('.toast') || {{}}).textContent || '', next: field.textContent,
        hint: field.querySelector('.job-late[title]')?.title }};""")
    check("recorded there, late: the job is done, the planting goes out as many days later, and both are said",
          pan["done"] == first["today"] and pan["date"] == plus(one["date"], one["late"]) and pan["state"] == "done"
          and "Hardened off" in pan["text"] and f"{one['late']} d late" in pan["text"] and "later" in pan["toast"]
          and f"{one['late']} d later" in pan["next"] and 'Edit “Transplant date”' in pan.get("hint", ""), pan)
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
    check("it is set out by job, and what is late comes after the week", "Harden off" in sheet["heads"] and "Plant out" in sheet["heads"] and any(h.startswith("Sow") for h in sheet["heads"]) and sheet["earlier"], sheet["heads"])
    sheet2 = js("const s = V.sheet(), t = s.querySelectorAll('table'), out = { h2: (s.querySelector('h2') || {}).textContent, rows: t.length > 1 ? t[1].querySelectorAll('tbody tr:not(.wkp-head):not(.wkp-half)').length : 0, want: V.figures().list.filter(l => l.week < now && l.state !== 'done').length + V.jobs().filter(l => l.week < now && l.state !== 'done').length }; V.showWeek(E.d2s(E.addDays(E.s2d(now), 7))); out.next = [V.sheet().querySelector('h1').textContent, !!V.sheet().querySelector('h2')]; V.show(A.today()); return out;")
    check("what is late is on this week's sheet, every task of it, because that is where it is listed: a later week's sheet has none", sheet2["h2"] == "Not recorded from earlier weeks" and sheet2["rows"] == sheet2["want"] and sheet2["want"] > 0 and sheet2["next"][0].startswith("Week of May 10") and sheet2["next"][1] is False, sheet2)
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
    ph = js("""const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0, today = A.today(), open = t => t.state === 'open' || t.state === 'part';
      const rows = [...document.querySelectorAll('.view-sow .tk-row')].filter(vis), ticks = rows.map(r => r.querySelector('.tk-tick').getBoundingClientRect()), tabs = [...document.querySelectorAll('#tkTabs button')];
      return { phone: document.body.classList.contains('phone'), view: S.view, nav: vis(document.querySelector('nav.views')), lib: vis(document.querySelector('.library')), insp: vis(document.querySelector('.inspector')), season: vis(document.querySelector('.season')),
        week: vis(document.querySelector('.view-sow')), sideways: document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1, title: $('wkTitle').textContent,
        rows: rows.length, halves: [...new Set(rows.map(r => r.closest('.tk-list').dataset.half))], lists: [...document.querySelectorAll('.tk-list')].filter(vis).length, tabs: tabs.map(b => [b.dataset.half, b.getAttribute('aria-selected'), b.textContent]),
        left: ['nursery', 'field'].map(h => V.tasks().filter(t => t.half === h && open(t) && t.due <= today).length), wideRows: rows.filter(r => r.getBoundingClientRect().right > innerWidth + 1 || [...r.querySelectorAll('.tk-sub, .tk-title, .tk-put, .tk-flag')].some(c => c.getBoundingClientRect().right > innerWidth + 1)).length,
        box: Math.min(...ticks.map(b => Math.min(b.width, b.height))), save: vis($('saveState')), backup: vis($('dataBtn')), full: vis($('wkFull')), undo: vis($('undoBtn')), print: !!$('wkPrint'), bench: !!document.querySelector('.view-sow .bn'), line: !!document.querySelector('.view-sow #bnLine'),
        top: document.querySelector('header.top').getBoundingClientRect().height, step: Math.min(...[...document.querySelectorAll('.tk-step button')].map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))), day: Math.min(...[...document.querySelectorAll('.tk-day')].map(b => b.getBoundingClientRect().height)),
        head: document.querySelector('.tk-wk-head').scrollWidth <= document.querySelector('.tk-wk-head').clientWidth + 1 };""")
    check("on a phone the planner opens on today's tasks, and they are all there is: no map, no library, no other views", ph["phone"] and ph["view"] == "sow" and ph["week"] and ph["title"] == "Today" and not ph["nav"] and not ph["lib"] and not ph["insp"] and not ph["season"], ph)
    check("one list at a time, Nursery first, each row a block that fits the screen, with nothing running off sideways", ph["rows"] > 0 and ph["lists"] == 1 and ph["halves"] == ["nursery"] and ph["wideRows"] == 0 and not ph["sideways"] and ph["head"], ph)
    check("the ticks, the days and the week buttons are big enough for a thumb", ph["box"] >= 40 and ph["step"] >= 40 and ph["day"] >= 44, ph)
    check("the header keeps what matters in one line: undo, whether it is saved, Backup (where Cloud sync is), and the way to the full planner", ph["save"] and ph["backup"] and ph["full"] and ph["undo"] and ph["top"] <= 60, ph)
    check("two tabs say what is left in each list, and there is no bench line or print button to scroll past", [t[:2] for t in ph["tabs"]] == [["nursery", "true"], ["field", "false"]] and ph["tabs"][0][2] == f"Nursery{ph['left'][0]} left" and ph["tabs"][1][2] == f"Field{ph['left'][1]} left" and not ph["bench"] and not ph["line"] and not ph["print"], ph)
    page.screenshot(path=str(shots / "phone-week.png"))
    pk = js("const l = V.jobs().find(l => l.week === now && l.state === 'open' && l.section === 'harden' && l.date < A.today()); return { key: l.key, ids: l.members.map(m => m.p.id), dates: l.members.map(m => m.p.date), late: E.dayDiff(E.s2d(A.today()), E.s2d(l.date)) };")
    for i in range(page.locator(".tk-list:not(.off) .tk-more").count()): page.locator(".tk-list:not(.off) .tk-more").first.click(); wait(250)
    r0 = page.locator(f'.tk-row[data-line={json.dumps(pk["key"])}]'); r0.scroll_into_view_if_needed(); r0.locator(".tk-tick").click(); page.wait_for_timeout(250); _ah = page.locator('[data-hook="tasks-ahead-yes"]'); _ah.first.click() if _ah.count() and _ah.first.is_visible() else None; wait(700)
    pb = js("const p = $('tkPop'), r = p.getBoundingClientRect(), k = p.querySelector('.tk-quick button').getBoundingClientRect(), c = p.querySelector('.tk-cell:not([disabled])').getBoundingClientRect(); return { pos: getComputedStyle(p).position, in: r.left >= 0 && r.right <= innerWidth + 1 && Math.abs(r.bottom - innerHeight) <= 1 && r.top >= 0, wide: r.width >= innerWidth - 1, button: k.height, quick: p.querySelector('.tk-quick').textContent, cell: Math.min(c.width, c.height), dim: getComputedStyle($('tkScrim')).backgroundColor };")
    check("a tap on a late task's tick brings the calendar up from the foot of the screen, whole, with Today to hit", pb["pos"] == "fixed" and pb["in"] and pb["wide"] and pb["button"] >= 44 and pb["quick"].startswith("Today") and pb["cell"] >= 40 and pb["dim"] != "rgba(0, 0, 0, 0)", pb)
    page.screenshot(path=str(shots / "phone-ticked.png"))
    page.click("#tkPop .tk-quick button"); wait(1500)
    pd = js(f"const ps = {json.dumps(pk['ids'])}.map(id => S.engine.planting(id)); return {{ done: ps.every(p => p.done && p.done.harden === A.today()), dates: ps.map(p => p.date), toast: document.querySelector('.toast').getBoundingClientRect().right <= innerWidth + 1 }};")
    check("recorded from the phone like anywhere else", pd["done"] and pd["dates"] == [js(f"return E.d2s(E.addDays(E.s2d('{d}'), {pk['late']}));") for d in pk["dates"]] and pd["toast"], pd)
    page.locator(".tk-list:not(.off) .tk-row:not(.done) .tk-words").first.click(); wait(500)
    wt = js("const o = document.querySelector('.tk-row.open'), was = E.d2s(S.date); return { open: !!o, map: o ? !!o.querySelector('[data-act=map]') : null, note: o ? o.querySelector('.tk-note').getBoundingClientRect().height : 0, skip: o ? !!o.querySelector('[data-act=skip]') : false, view: S.view, same: E.d2s(S.date) === was, sel: S.sel ? S.sel.type : null };")
    check("a tap on a task's words opens it for a note, a delay or a skip, with no way off to the map: the page does not wander, change the planner's date or select anything", wt["open"] and wt["map"] is False and wt["note"] >= 36 and wt["skip"] and wt["view"] == "sow" and wt["same"] and wt["sel"] is None, wt)
    page.keyboard.press("Escape"); wait(300)
    page.locator('#tkTabs [data-half="field"]').click(); wait(500)
    tb = js("const vis = e => getComputedStyle(e).display !== 'none'; return { halves: [...new Set([...document.querySelectorAll('.tk-row')].filter(r => vis(r.closest('.tk-list'))).map(r => r.closest('.tk-list').dataset.half))], sel: document.querySelector('#tkTabs [aria-selected=true]').dataset.half };")
    page.locator('#tkTabs [data-half="nursery"]').click(); wait(300)
    page.locator('.tk-step button').nth(1).click(); wait(500)
    nx = js("return { week: V.where().week, day: V.where().day, title: $('wkTitle').textContent, today: !!$('wkToday'), tab: tb => 0 };".replace("tab: tb => 0", "planner: E.d2s(S.date)"))
    check("the other list is one tap away, and so is the next week, whole; “Today” comes back", tb["halves"] == ["field"] and tb["sel"] == "field" and nx["week"].endswith("-05-10") and nx["day"] is None and nx["title"] == "Next week" and nx["today"], [tb, nx])
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
