"""The Tasks page's sowings in a real browser: a week's rows, a tick that records at once, seed off stock, taking back,
a note, a skip, sowings that share trays, putting a sowing off, the calendar, undo, and what survives a reload.
The page's clock is the real one, so the plan's year is ahead of today: nothing here is late, and every tick is early.
usage: python3 -I sowing_view_check.py <app-dir-or-html-file> <shots-dir>
"""
import functools, http.server, json, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
is_file = target.is_file()
if is_file: url = target.as_uri(); server = None
else:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok: failed.append(name)
PRE = "const A = LRFApp, S = A.state, E = LRFEngine, V = LRFSowView, SL = LRFSeedLib;"
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--allow-file-access-from-files"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}); page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text else None)
    WEEK = [""]   # the week the check works in: found on the plan, below. "WEEK0" in a script stands for it.
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body.replace("WEEK0", WEEK[0]) + " })()")
    ready = lambda: (page.wait_for_function("window.LRFApp && LRFApp.state.ready"), page.wait_for_timeout(700))
    page.goto(url); ready()
    page.click('[data-view-btn="sow"]'); page.wait_for_timeout(400)
    # a week with what the check needs: a batch several plantings share, another line beside it, varieties of one crop that
    # share trays, and sowings before it that are not recorded
    WEEK[0] = js("""const f = V.figures(), weeks = [...new Set(f.list.map(l => l.week))].sort();
      return weeks.find(w => { const week = f.list.filter(l => l.week === w), shared = week.find(l => l.members.length > 1);
        return shared && week.some(l => l !== shared) && week.some(l => l.group && l.state === 'open') && f.list.some(l => l.week < w && l.state !== 'done'); }) || '';""")
    check("the plan has a week with a shared batch, another line, varieties sharing trays, and sowings before it", bool(WEEK[0]), WEEK[0])
    wait = lambda ms=350: page.wait_for_timeout(ms)
    row = lambda key: page.locator(f'.tk-row[data-line={json.dumps(key)}]')
    toast = lambda: js("return (document.querySelector('.toast') || {}).textContent || ''")
    def tick(key): row(key).locator(".tk-tick").click(); wait(1400)
    def unfold():
        for i in range(page.locator('.tk-fold[aria-expanded="false"]').count()): page.locator('.tk-fold[aria-expanded="false"]').first.click(); wait(120)
        wait(400)
    js("V.showWeek('WEEK0')"); wait()

    first = js("""const f = V.figures(), now = 'WEEK0', end = E.d2s(E.addDays(E.s2d(now), 6)), week = f.list.filter(l => l.week === now), all = V.tasks().filter(t => t.due >= now && t.due <= end && (t.state === 'open' || t.state === 'part'));
      const conserved = f.list.filter(l => l.batch && (l.kind === 'plugs' || l.kind === 'rockwool')).every(l => l.batch.seeds === l.members.reduce((n, m) => n + m.r.seeds, 0) && l.batch.cells === l.members.reduce((n, m) => n + m.r.cells, 0));
      const ids = f.list.flatMap(l => l.members.map(m => m.p.id));
      const seedPlantings = S.plan.plantings.filter(p => { const s = SL.sowing(S.engine, p); return s && (s.unit === 'seeds' || s.unit === 'g') && String(p.date).slice(0, 4) === String(A.planYear()) && s.r.b.active !== false && s.r.g.active !== false; }).length;
      const rows = [...document.querySelectorAll('.view-sow .tk-list .tk-row')];
      return { lines: f.list.length, week: week.length, tasks: all.length, rows: rows.length, sowRows: rows.filter(r => ['plugs', 'rockwool', 'live', 'direct'].includes(r.dataset.kind)).length, conserved, unique: new Set(ids).size === ids.length, members: ids.length, seedPlantings,
        kinds: [...new Set(f.list.map(l => l.kind))].sort(), title: document.getElementById('wkTitle').textContent, range: document.getElementById('tkRange').textContent, late: document.querySelectorAll('.tk-sec.late').length, lateRows: document.querySelectorAll('.tk-put.late').length,
        outside: rows.filter(r => r.dataset.due < now || r.dataset.due > end).length, where: V.where(), earlier: f.list.filter(l => l.week < now && l.state !== 'done').length, nav: document.querySelector('[data-view-btn="sow"]').getAttribute('aria-pressed') };""")
    check("the view lists every sowing of seed once: each planting sown from seed is on exactly one line", first["unique"] and first["members"] == first["seedPlantings"] and first["lines"] > 100, first)
    check("a week shows that week's tasks, a row each, and the head says how many", first["week"] > 0 and first["sowRows"] == first["week"] and first["rows"] == first["tasks"] and f"{first['tasks']} planned" in first["range"] and first["where"]["day"] is None and first["nav"] == "true", first)
    check("a shared batch's cells and seeds are exactly the sum of its plantings' shares", first["conserved"], first)
    check("late is judged against today, not the week looked at: a week ahead of today holds its own tasks, and none of an earlier week", first["earlier"] > 0 and first["late"] == 0 and first["lateRows"] == 0 and first["outside"] == 0, first)

    # a tick records a line at once: a shared batch, then one more line
    pick = js("""const f = V.figures(), week = f.list.filter(l => l.week === 'WEEK0'), shared = week.find(l => l.members.length > 1), other = week.find(l => l !== shared);
      return { shared: shared && { key: shared.key, n: shared.members.length, ids: shared.members.map(m => m.p.id), estimate: shared.estimate, name: shared.name }, other: other && { key: other.key, ids: other.members.map(m => m.p.id), estimate: other.estimate },
        undo: S.undo.length, open: document.querySelectorAll('.tk-row:not(.done)').length };""")
    tick(pick["shared"]["key"])
    one = js(f"""const ids = {json.dumps(pick["shared"]["ids"])}, today = A.today(), ps = ids.map(id => S.engine.planting(id));
      const use = p => ((p.workflow || {{}}).seedUse || []).reduce((n, u) => n + u.quantity, 0);
      return {{ dated: ps.every(p => p.done && (p.done.sow === today || p.done.field === today)), undo: S.undo.length, label: S.undo[S.undo.length - 1].label, sharedUsed: ps.map(use).reduce((a, b) => a + b, 0),
        open: document.querySelectorAll('.tk-row:not(.done)').length, still: [...document.querySelectorAll('.tk-row')].some(r => r.dataset.line === {json.dumps(pick["shared"]["key"])}), range: document.getElementById('tkRange').textContent, toast: (document.querySelector('.toast') || {{}}).textContent || '' }};""")
    check("one tick dates every planting of the line today, as one step that can be undone", one["dated"] and one["undo"] == pick["undo"] + 1 and f"{len(pick['shared']['ids'])} sowings recorded" in one["label"], one)
    check("the batch's seed is recorded across its plantings and adds up to the batch", one["sharedUsed"] == pick["shared"]["estimate"], {"used": one["sharedUsed"], "estimate": pick["shared"]["estimate"]})
    check("the row leaves the week, the count follows, and the message says what was recorded and that it was early", one["open"] == pick["open"] - 1 and not one["still"] and f"{first['tasks'] - 1} planned" in one["range"] and " sown today" in one["toast"] and "early" in one["toast"] and "Undo" in one["toast"], one)
    page.screenshot(path=str(shots / "sowing-ticked.png"))
    tick(pick["other"]["key"])

    # what was done today is under today, folded; unticking it there takes it back
    js("V.show(A.today())"); wait()
    unfold()
    done = js(f"""const rows = [...document.querySelectorAll('.tk-fold-body .tk-row.done')]; return {{ rows: rows.length, both: [{json.dumps(pick["shared"]["key"])}, {json.dumps(pick["other"]["key"])}].every(k => rows.some(r => r.dataset.line === k)), fold: document.querySelector('.tk-fold').textContent, title: document.getElementById('wkTitle').textContent, when: rows.map(r => r.querySelector('.tk-when').textContent) }};""")
    row(pick["shared"]["key"]).locator(".tk-tick").click(); wait(500)
    back = js(f"""const ps = {json.dumps(pick["shared"]["ids"])}.map(id => S.engine.planting(id)), t = V.tasks().find(t => t.key === {json.dumps(pick["shared"]["key"])}); return {{ cleared: ps.every(p => !(p.done && p.done.sow)), uses: ps.every(p => !((p.workflow || {{}}).seedUse || []).length), undo: S.undo.length, state: t && t.state, toast: (document.querySelector('.toast') || {{}}).textContent || '' }};""")
    check("what was ticked is under today, in “Completed today”, and unticking a line there clears all its plantings in one step",
          done["title"] == "Today" and done["rows"] == 2 and done["both"] and "Completed today" in done["fold"] and all(w == "Done" for w in done["when"]) and back["cleared"] and back["uses"] and back["undo"] == pick["undo"] + 3 and back["state"] == "open" and "taken back" in back["toast"], {"done": done, "back": back})

    # a note is kept with the task and shown on its row
    js("V.showWeek('WEEK0')"); wait()
    row(pick["shared"]["key"]).locator(".tk-words").click(); wait(450)
    page.fill(".tk-row.open .tk-note", "the heat mat is on bench two"); page.press(".tk-row.open .tk-note", "Enter"); wait(450)
    noted = js(f"""const ps = {json.dumps(pick["shared"]["ids"])}.map(id => S.engine.planting(id)); return {{ kept: ps.every(p => p.tasks && p.tasks.note && Object.values(p.tasks.note)[0] === 'the heat mat is on bench two'), sub: [...document.querySelectorAll('.tk-row')].find(r => r.dataset.line === {json.dumps(pick["shared"]["key"])}).querySelector('.tk-sub').textContent, undo: S.undo.length, open: !!document.querySelector('.tk-row.open') }};""")
    check("a note typed on an opened row is kept with the task, in one step, and the row says it", noted["kept"] and "“the heat mat is on bench two”" in noted["sub"] and noted["undo"] == pick["undo"] + 4 and not noted["open"], noted)

    # seed that is on hand comes off its lot
    stocked = js("""const f = V.figures(), stock = A.stockNow(); const l = f.list.find(l => l.state === 'open' && l.unit === 'seeds' && ((stock[l.stockKey + '|' + l.stockUnit] || {}).onHand || 0) >= l.estimate && l.estimate > 0);
      return l ? { key: l.key, week: l.week, estimate: l.estimate, had: stock[l.stockKey + '|' + l.stockUnit].onHand, stockKey: l.stockKey + '|' + l.stockUnit, ids: l.members.map(m => m.p.id) } : null;""")
    if stocked:
        js(f"V.showWeek('{stocked['week']}')"); wait()
        flagged = row(stocked["key"]).locator(".tk-flag").count()
        tick(stocked["key"])
        took = js(f"""const now = (A.stockNow()[{json.dumps(stocked["stockKey"])}] || {{}}).onHand || 0, ps = {json.dumps(stocked["ids"])}.map(id => S.engine.planting(id));
          return {{ now, fromLots: ps.every(p => ((p.workflow || {{}}).seedUse || []).every(u => u.lotId && !u.untracked)), toast: (document.querySelector('.toast') || {{}}).textContent || '' }};""")
        check("seed on hand comes off its lot when the sowing is ticked, the message says how much, and a line with seed enough carries no warning", took["now"] == stocked["had"] - stocked["estimate"] and took["fromLots"] and flagged == 0 and f"{stocked['estimate']:,} seed" in took["toast"] and "off stock" in took["toast"], {"took": took, "stocked": stocked, "flagged": flagged})
    else: check("a line with seed on hand exists to test with", False)

    # a skipped task leaves the list and nothing else about its plantings changes; unticking it brings it back
    js("V.showWeek('WEEK0')"); wait()
    skipKey = js("""const t = V.tasks().find(t => t.due >= 'WEEK0' && t.sow && t.state === 'open' && !t.line.group); return t ? t.key : null;""")
    before = js(f"""const t = V.tasks().find(t => t.key === {json.dumps(skipKey)}); return {{ ids: t.line.members.map(m => m.p.id), plain: JSON.stringify(t.line.members.map(m => {{ const {{ tasks, ...rest }} = m.p; return rest; }})), need: SL.required(S.engine).rows.reduce((n, x) => n + x.toSow, 0), undo: S.undo.length, counts: JSON.stringify(V.weekCounts('WEEK0')) }};""")
    js(f"V.showWeek(V.tasks().find(t => t.key === {json.dumps(skipKey)}).due)"); wait()
    row(skipKey).locator(".tk-words").click(); wait(450)
    page.click(".tk-row.open [data-act=skip]"); wait(500)
    skipped = js(f"""const t = V.tasks().find(t => t.key === {json.dumps(skipKey)}), ps = {json.dumps(before["ids"])}.map(id => S.engine.planting(id));
      return {{ state: t.state, on: t.on, today: A.today(), plain: JSON.stringify(ps.map(p => {{ const {{ tasks, ...rest }} = p; return rest; }})), marks: ps.every(p => p.tasks && p.tasks.skip), need: SL.required(S.engine).rows.reduce((n, x) => n + x.toSow, 0), undo: S.undo.length,
        open: [...document.querySelectorAll('.tk-row:not(.done)')].some(r => r.dataset.line === {json.dumps(skipKey)}), toast: (document.querySelector('.toast') || {{}}).textContent || '' }};""")
    js("V.show(A.today())"); wait(); unfold()
    said = row(skipKey).locator(".tk-when").text_content()
    row(skipKey).locator(".tk-tick").click(); wait(500)
    unskipped = js(f"""const t = V.tasks().find(t => t.key === {json.dumps(skipKey)}); return {{ state: t.state, clean: {json.dumps(before["ids"])}.every(id => !(S.engine.planting(id).tasks || {{}}).skip), undo: S.undo.length }};""")
    check("a skipped task leaves the list on the day it was skipped, nothing of its plantings changes but the mark, and unticking it puts it back",
          skipped["state"] == "skipped" and skipped["on"] == skipped["today"] and skipped["plain"] == before["plain"] and skipped["marks"] and skipped["need"] == before["need"] and skipped["undo"] == before["undo"] + 1 and not skipped["open"] and "skipped" in skipped["toast"]
          and said == "Skipped" and unskipped["state"] == "open" and unskipped["clean"] and unskipped["undo"] == before["undo"] + 2, {"skipped": skipped, "said": said, "unskipped": unskipped})

    # varieties of one crop sharing trays: one line above them says so, and each row says its tray and rows
    js("V.showWeek('WEEK0')"); wait()
    grp = js("""const f = V.figures(), lines = f.list.filter(l => l.week === 'WEEK0' && l.group && l.state === 'open'), g = lines.length ? lines[0].group : null, mine = g ? lines.filter(l => l.group === g) : [];
      const head = [...document.querySelectorAll('.tk-share')].find(e => e.dataset.group === (mine[0] || {}).groupLines[0].key), rowOf = l => [...document.querySelectorAll('.tk-row')].find(r => r.dataset.line === l.key);
      return g ? { trays: g.trays, per: g.tray.rows, lines: mine.length, apart: g.apart, head: head ? head.textContent : '', next: head && head.nextElementSibling ? head.nextElementSibling.dataset.line : null, firstKey: mine[0].groupLines[0].key,
        subs: mine.map(l => rowOf(l) ? rowOf(l).querySelector('.tk-sub').textContent : ''), together: mine.every((l, i) => !i || (rowOf(l) && rowOf(l).previousElementSibling === rowOf(mine[i - 1]))) } : null;""")
    check("varieties of one crop that share trays get one line saying how many trays, stand together under it, and each row says its tray and rows",
          grp and grp["trays"] < grp["apart"] and f"share {grp['trays']} tray" in grp["head"] and "filled in the order listed" in grp["head"] and grp["next"] == grp["firstKey"] and grp["together"] and all(" · tray " in t and "row" in t for t in grp["subs"]), grp)

    # rockwool for the towers: a sowing alone on its sheets counts them, and the open trays they ride in, on its own row; sowings
    # that share sheets have them counted once, on the line above, and each row is told its sheet and rows.
    wool = js("""const f = V.figures(), open = f.list.filter(x => x.kind === 'rockwool' && x.state === 'open'), lone = open.find(x => !x.group), shared = open.find(x => x.group && x.groupLines.length > 1), out = { lone: null, shared: null };
      const sub = l => { const r = [...document.querySelectorAll('.tk-row')].find(r => r.dataset.line === l.key); return r ? r.querySelector('.tk-sub').textContent : ''; };
      if (lone) { V.showWeek(lone.week); out.lone = { text: sub(lone), sheets: lone.batch.trays, week: lone.week }; }
      if (shared) { V.showWeek(shared.week); const g = shared.group, head = [...document.querySelectorAll('.tk-share')].find(r => r.dataset.group === shared.groupLines[0].key);
        out.shared = { text: head ? head.textContent : '', sheets: g.trays, sowings: shared.groupLines.length, own: sub(shared), week: shared.week }; }
      return out;""")
    check("the plan has a tower sowing still to do, alone on its sheets or sharing them", wool["lone"] or wool["shared"], wool)
    check("the plan has a tower sowing alone on its sheets", bool(wool["lone"]), wool)
    check("the plan has tower sowings that share sheets", bool(wool["shared"]), wool)
    check("a tower sowing says how many rockwool sheets, and that each rides in an open 1020 tray", (wool["lone"] or wool["shared"])
          and (not wool["lone"] or (f"{wool['lone']['sheets']} sheet" in wool["lone"]["text"] and "open 1020 tray" in wool["lone"]["text"]))
          and (not wool["shared"] or (f"{wool['shared']['sowings']} sowings share {wool['shared']['sheets']} sheet" in wool["shared"]["text"] and f"on {wool['shared']['sheets']} open 1020 tray" in wool["shared"]["text"] and " · sheet " in wool["shared"]["own"])), wool)

    # putting a sowing off, on purpose: the calendar, then the plan moves and says so
    plan = js("""const f = V.figures(), open = f.list.filter(l => l.state === 'open' && !l.set), tp = open.find(l => l.kind === 'plugs' && l.members.length > 1 && l.week >= '2027-04-05' && E.d2s(E.addDays(E.s2d(l.date), 3)).slice(0, 4) === '2027'), live = open.find(l => l.kind === 'live' && l.week === (tp && tp.week));
      const need = SL.required(S.engine).rows.reduce((n, x) => n + x.toSow, 0);
      return tp && live ? { week: tp.week, tp: { key: tp.key, ids: tp.members.map(m => m.p.id), date: tp.date, out: tp.members.map(m => E.d2s(m.r.field)) }, live: { key: live.key, id: live.members[0].p.id, date: live.date, ready: E.d2s(live.members[0].r.first) }, need, undo: S.undo.length, done: S.plan.plantings.filter(p => p.done && p.done.sow).length } : null;""")
    if plan:
        js(f"V.showWeek('{plan['week']}')"); wait()
        target = js(f"return E.d2s(E.addDays(E.s2d('{plan['tp']['date']}'), 3))")
        row(plan["tp"]["key"]).locator(".tk-main").hover(); row(plan["tp"]["key"]).locator(".tk-put").click(); wait(450)
        pop = js(f"""const p = document.getElementById('tkPop'), cell = k => [...p.querySelectorAll('.tk-cell')].find(c => c.getAttribute('aria-label').startsWith(k));
          return {{ shown: !p.hidden, head: p.querySelector('strong').textContent, about: p.querySelector('small').textContent, quick: (p.querySelector('.tk-quick') || {{}}).textContent || '', cur: [...p.querySelectorAll('.tk-cell.cur')].map(c => [c.textContent, c.disabled]), month: p.querySelector('.tk-calhead b').textContent,
            past: [...p.querySelectorAll('.tk-cell:not([disabled])')].every(c => c.dataset.pick >= A.today()), pending: !!document.querySelector('.tk-row.pending'), mode: V.where().pop }};""")
        page.hover(f'#tkPop [data-pick="{target}"]'); wait(200); hint = page.inner_text("#tkHint")
        page.click(f'#tkPop [data-pick="{target}"]'); wait(600)
        check("Delay opens the calendar on the task's month: the day it is on is marked and cannot be picked, no day before today can be, and a day pointed at says what it would do",
              pop["shown"] and pop["head"] == "Delay it to" and pop["mode"] == "delay" and pop["pending"] and pop["past"] and pop["cur"] == [[str(int(plan["tp"]["date"][8:])), True]] and "3 days later" in hint and "what follows it moves as many days" in hint, {"pop": pop, "hint": hint})
        row(plan["live"]["key"]).locator(".tk-main").hover(); row(plan["live"]["key"]).locator(".tk-put").click(); wait(450)
        live_to = js(f"return E.d2s(E.addDays(E.s2d('{plan['live']['date']}'), 3))")
        page.click(f'#tkPop [data-pick="{live_to}"]'); wait(600)
        planned = js(f"""const tp = {json.dumps(plan["tp"]["ids"])}.map(id => S.engine.planting(id)), live = S.engine.planting({json.dumps(plan["live"]["id"])}), rl = S.engine.calc(live), plus = (iso, n) => E.d2s(E.addDays(E.s2d(iso), n));
          const outs = {json.dumps(plan["tp"]["out"])}, t = V.tasks().find(t => t.sow && t.line.members.some(m => m.p.id === tp[0].id)); V.show(t.due); const rowEl = [...document.querySelectorAll('.tk-row')].find(r => r.dataset.line === t.key);
          return {{ tp: tp.map((p, i) => [E.d2s(S.engine.calc(p).sow), E.d2s(S.engine.calc(p).field) === plus(outs[i], 3), !!(p.done && p.done.sow), p.tasks && p.tasks.delay && p.tasks.delay.sow]), live: [live.date, E.d2s(rl.first) === plus('{plan["live"]["ready"]}', 3), !!(live.done && live.done.sow)],
            need: SL.required(S.engine).rows.reduce((n, x) => n + x.toSow, 0), done: S.plan.plantings.filter(p => p.done && p.done.sow).length, undo: S.undo.length, from: t.line.delayedFrom, sub: rowEl ? rowEl.querySelector('.tk-sub').textContent : '', toast: (document.querySelector('.toast') || {{}}).textContent || '' }};""")
        check("putting sowings off moves each to its day in one step: nothing is marked sown, no seed is taken, and the day they go out or are due moves as many days",
              all(t[0] == target and t[1] and not t[2] and t[3] == {"from": plan["tp"]["date"], "to": target} for t in planned["tp"]) and planned["live"][0] == live_to and planned["live"][1] and not planned["live"][2]
              and planned["need"] == plan["need"] and planned["done"] == plan["done"] and planned["undo"] == plan["undo"] + 2 and "put off to" in planned["toast"], {"planned": planned, "plan": plan, "target": target})
        check("the row says the day it was delayed from, and Undo puts it back where it was", planned["from"] == plan["tp"]["date"] and "delayed from" in planned["sub"]
              and (page.keyboard.press("Control+z"), page.keyboard.press("Control+z"), wait(450), js(f"""return {json.dumps(plan["tp"]["ids"])}.every(id => E.d2s(S.engine.calc(S.engine.planting(id)).sow) === '{plan["tp"]["date"]}' && !S.engine.planting(id).tasks) && S.engine.planting({json.dumps(plan["live"]["id"])}).date === '{plan["live"]["date"]}' && S.undo.length === {plan["undo"]}"""))[3], planned)
    else: check("a week with a shared plug batch and a tray batch exists to plan with", False)

    # the calendar goes to any day, from the date beside the title and from the week's dates
    js("V.show(A.today())"); wait()
    page.click("#tkDate"); wait(400)
    cal = js("const p = document.getElementById('tkPop'); return { head: p.querySelector('strong').textContent, dots: p.querySelectorAll('.tk-cell.has').length, sel: [...p.querySelectorAll('.tk-cell.sel')].map(c => c.dataset.pick), today: A.today(), quick: p.querySelector('.tk-quick').textContent };")
    page.keyboard.press("Escape"); wait(250)
    js("V.showWeek('WEEK0')"); wait(); page.click("#tkWeek"); wait(400)
    far = js("return E.d2s(E.addDays(E.s2d('WEEK0'), 16))")
    for _ in range(3):
        if page.locator(f'#tkPop [data-pick="{far}"]').count(): break
        page.click('#tkPop [data-month="1"]'); wait(200)
    dots = js("return document.querySelectorAll('#tkPop .tk-cell.has').length")
    page.click(f'#tkPop [data-pick="{far}"]'); wait(450)
    went = js("return { where: V.where(), title: document.getElementById('wkTitle').textContent, pop: document.getElementById('tkPop').hidden }")
    check("the date beside the title and the week's dates both open “Go to a day”: a dot marks a day with tasks, and a pick shows that day, or its week when a whole week is on screen",
          cal["head"] == "Go to a day" and cal["sel"] == [cal["today"]] and "Today" in cal["quick"] and dots > 0 and went["where"]["day"] is None and went["where"]["week"] == js(f"return LRFTrays.monday('{far}')") and went["pop"], {"cal": cal, "dots": dots, "went": went})

    # undo walks all of it back; a reload keeps what was recorded
    count = js("return S.undo.length") - pick["undo"]
    kept = js("return S.plan.plantings.filter(p => p.done && (p.done.sow || p.done.field)).length")
    page.reload(); ready(); page.click('[data-view-btn="sow"]'); page.wait_for_timeout(500)
    again = js("return { done: S.plan.plantings.filter(p => p.done && (p.done.sow || p.done.field)).length, title: document.getElementById('wkTitle').textContent, fold: (document.querySelector('.tk-fold') || {}).textContent || '', save: document.getElementById('saveState').textContent.trim() }")
    check("recorded sowings are still there after the page is reloaded, and the page opens on today", again["done"] == kept and kept > 0 and again["title"] == "Today" and "Completed today" in again["fold"], {"again": again, "kept": kept})
    wide = js("return { x: document.documentElement.scrollWidth > window.innerWidth, list: [...document.querySelectorAll('.view-sow .tk-list, .view-sow .tk-week')].some(e => e.scrollWidth > e.clientWidth + 1) }")
    check("nothing runs off the side at 1280 wide", not wide["x"] and not wide["list"], wide)
    check("no errors on the page", not errors, errors[:4])
    page.screenshot(path=str(shots / "sowing-view.png"))
    browser.close()
if server: server.shutdown()
print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "results": [r for r in results if not r["ok"]], "undoSteps": count}, indent=1))
sys.exit(1 if failed else 0)
