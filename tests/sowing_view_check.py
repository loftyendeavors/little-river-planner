"""The Sowing view in a real browser: the week's lines, ticking several, recording them in one step, seed off stock,
a typed quantity shared out, taking back, undo, and what survives a reload.
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
    js("A.setDate(E.s2d('WEEK0'))"); page.wait_for_timeout(300)

    first = js("""const f = V.figures(), now = 'WEEK0', week = f.list.filter(l => l.week === now);
      const conserved = f.list.filter(l => l.batch && (l.kind === 'plugs' || l.kind === 'rockwool')).every(l => l.batch.seeds === l.members.reduce((n, m) => n + m.r.seeds, 0) && l.batch.cells === l.members.reduce((n, m) => n + m.r.cells, 0));
      const ids = f.list.flatMap(l => l.members.map(m => m.p.id));
      const seedPlantings = S.plan.plantings.filter(p => { const s = SL.sowing(S.engine, p); return s && (s.unit === 'seeds' || s.unit === 'g') && String(p.date).slice(0, 4) === String(A.planYear()) && s.r.b.active !== false && s.r.g.active !== false; }).length;
      return { lines: f.list.length, week: week.length, rows: document.querySelectorAll('.view-sow > .sw-wrap > .wk-half > .sw-kind table.sw tbody tr[data-line]').length, conserved, unique: new Set(ids).size === ids.length, members: ids.length, seedPlantings,
        kinds: [...new Set(f.list.map(l => l.kind))].sort(), tiles: [...document.querySelectorAll('.sw-stats .tr-stat strong')].map(e => e.textContent), earlier: f.list.filter(l => l.week < now && l.state !== 'done').length, earlierJobs: V.jobs().filter(l => l.week < now && l.state !== 'done').length,
        summary: (document.querySelector('.sw-earlier summary b') || {}).textContent, nav: document.querySelector('[data-view-btn="sow"]').getAttribute('aria-pressed') };""")
    check("the view lists every sowing of seed once: each planting sown from seed is on exactly one line", first["unique"] and first["members"] == first["seedPlantings"] and first["lines"] > 100, first)
    check("a week shows that week's lines, and the tiles say how many", first["week"] > 0 and first["rows"] == first["week"] and first["tiles"][0] == f"{first['week']} to sow" and first["nav"] == "true", first)
    check("a shared batch's cells and seeds are exactly the sum of its plantings' shares", first["conserved"], first)
    check("earlier sowings not recorded are counted (with the other jobs, since 0.26), folded away", first["earlier"] > 0 and f"{first['earlier'] + first['earlierJobs']:,} earlier task" in (first["summary"] or ""), first)

    # tick a shared batch and one more line, and record them together
    pick = js("""const f = V.figures(), week = f.list.filter(l => l.week === 'WEEK0'), shared = week.find(l => l.members.length > 1), other = week.find(l => l !== shared);
      return { shared: shared && { key: shared.key, n: shared.members.length, ids: shared.members.map(m => m.p.id), estimate: shared.estimate, name: shared.name }, other: other && { key: other.key, ids: other.members.map(m => m.p.id), estimate: other.estimate },
        undo: S.undo.length, snapshot: JSON.stringify([S.plan.plantings, S.plan.seedInventory || null]).length };""")
    row = lambda key: page.locator(f'table.sw tbody tr[data-line={json.dumps(key)}]')
    row(pick["shared"]["key"]).locator('input[type="checkbox"]').check(); page.wait_for_timeout(150)
    row(pick["other"]["key"]).locator("td.sw-what").click(); page.wait_for_timeout(150)
    bar = js("const b = document.querySelector('.sw-record'); return b ? { text: b.querySelector('b').textContent, button: document.getElementById('swRecord').textContent, date: b.querySelector('input[type=date]').value, today: A.today(), on: document.querySelectorAll('table.sw tr.on').length } : null;")
    check("ticking two lines (a checkbox, and a click on the row) brings up one button for both", bar and bar["text"] == "2 sowings ticked" and bar["button"] == "Record 2 sowings" and bar["date"] == bar["today"] and bar["on"] == 2, bar)
    page.screenshot(path=str(shots / "sowing-ticked.png"))
    page.click("#swRecord"); page.wait_for_timeout(500)
    ids = pick["shared"]["ids"] + pick["other"]["ids"]
    after = js(f"""const ids = {json.dumps(ids)}, today = A.today(), ps = ids.map(id => S.engine.planting(id));
      const use = p => ((p.workflow || {{}}).seedUse || []).reduce((n, u) => n + u.quantity, 0);
      return {{ dated: ps.every(p => p.done && (p.done.sow === today || p.done.field === today)), undo: S.undo.length, label: S.undo[S.undo.length - 1].label, used: ps.map(use),
        sharedUsed: {json.dumps(pick["shared"]["ids"])}.map(id => use(S.engine.planting(id))).reduce((a, b) => a + b, 0), doneRows: document.querySelectorAll('table.sw tr.done').length, bar: !!document.querySelector('.sw-record'),
        tile: document.querySelector('.sw-stats .tr-stat strong').textContent, toast: (document.querySelector('.toast') || {{}}).textContent || '', season: document.querySelectorAll('.sw-stats .tr-stat strong')[5].textContent }};""")
    check("one click dates every planting of both lines, as one step that can be undone", after["dated"] and after["undo"] == pick["undo"] + 1 and "2 sowings" not in after["label"] and f"{len(ids)} sowings recorded" in after["label"], after)
    check("the batch's seed is recorded across its plantings and adds up to the batch", after["sharedUsed"] == pick["shared"]["estimate"], {"used": after["sharedUsed"], "estimate": pick["shared"]["estimate"]})
    check("the lines show as sown, the button goes, and the tiles follow", after["doneRows"] == 2 and not after["bar"] and after["tile"] == f"{first['week'] - 2} to sow" and after["season"].startswith("2 of") and "recorded" in after["toast"], after)

    # taking a line back clears its plantings and returns nothing that was not counted
    row(pick["shared"]["key"]).locator("button.link", has_text="Take back").click(); page.wait_for_timeout(400)
    back = js(f"""const ps = {json.dumps(pick["shared"]["ids"])}.map(id => S.engine.planting(id)); return {{ cleared: ps.every(p => !(p.done && p.done.sow)), uses: ps.every(p => !((p.workflow || {{}}).seedUse || []).length), undo: S.undo.length, open: document.querySelector('table.sw tbody tr[data-line={json.dumps(pick["shared"]["key"])}]').dataset.state }};""")
    check("Take back on a line clears all its plantings in one step", back["cleared"] and back["uses"] and back["undo"] == pick["undo"] + 2 and back["open"] == "open", back)

    # a typed quantity is shared out in whole seeds and adds up exactly
    row(pick["shared"]["key"]).locator('input[type="checkbox"]').check(); page.wait_for_timeout(150)
    typed = pick["shared"]["estimate"] + 7
    qty = row(pick["shared"]["key"]).locator("input.sw-qty"); qty.fill(str(typed)); qty.dispatch_event("change"); page.click("#swRecord"); page.wait_for_timeout(500)
    share = js(f"""const us = {json.dumps(pick["shared"]["ids"])}.map(id => ((S.engine.planting(id).workflow || {{}}).seedUse || []).reduce((n, u) => n + u.quantity, 0)); return {{ us, sum: us.reduce((a, b) => a + b, 0), whole: us.every(Number.isInteger) }};""")
    check("a typed amount is shared among the batch's plantings in whole seeds and adds up to what was typed", share["sum"] == typed and share["whole"] and len(set(share["us"])) >= 1, share)

    # seed that is on hand comes off its lot; the row said it was there
    stocked = js("""const f = V.figures(), stock = A.stockNow(); const l = f.list.find(l => l.state === 'open' && l.unit === 'seeds' && ((stock[l.stockKey + '|' + l.stockUnit] || {}).onHand || 0) >= l.estimate && l.estimate > 0);
      return l ? { key: l.key, week: l.week, estimate: l.estimate, had: stock[l.stockKey + '|' + l.stockUnit].onHand, stockKey: l.stockKey + '|' + l.stockUnit, ids: l.members.map(m => m.p.id) } : null;""")
    if stocked:
        js(f"A.setDate(E.s2d('{stocked['week']}'))"); page.wait_for_timeout(300)
        note = row(stocked["key"]).locator("td.sw-seed small").first.text_content()
        row(stocked["key"]).locator('input[type="checkbox"]').check(); page.wait_for_timeout(150); page.click("#swRecord"); page.wait_for_timeout(500)
        took = js(f"""const now = (A.stockNow()[{json.dumps(stocked["stockKey"])}] || {{}}).onHand || 0, ps = {json.dumps(stocked["ids"])}.map(id => S.engine.planting(id));
          return {{ now, fromLots: ps.every(p => ((p.workflow || {{}}).seedUse || []).every(u => u.lotId && !u.untracked)), toast: (document.querySelector('.toast') || {{}}).textContent || '' }};""")
        check("seed on hand comes off its lot when the sowing is recorded, and the line had said it was there", took["now"] == stocked["had"] - stocked["estimate"] and took["fromLots"] and "on hand" in (note or "") and "off stock" in took["toast"], {"took": took, "stocked": stocked, "note": note})
    else: check("a line with seed on hand exists to test with", False)

    # the folded list of earlier sowings opens, and its header box ticks a whole section
    js("A.setDate(E.s2d('2027-06-14'))"); page.wait_for_timeout(300)
    page.click(".sw-earlier summary"); page.wait_for_timeout(400)
    earlier = js("""const f = V.figures(), e = f.list.filter(l => l.week < '2027-06-14' && l.state !== 'done'); const sec = document.querySelector('.sw-earlier .sw-kind');
      return { want: e.length, rows: document.querySelectorAll('.sw-earlier .sw-kind table.sw tbody tr[data-line]').length, first: sec ? sec.dataset.kind : null, inFirst: sec ? sec.querySelectorAll('tbody tr[data-line]').length : 0 };""")
    page.locator(".sw-earlier .sw-kind").first.locator("thead input[type=checkbox]").check(); page.wait_for_timeout(400)
    allbar = js("const b = document.querySelector('.sw-record b'); return b ? b.textContent : '';")
    check("the earlier sowings open in place, and a section's header box ticks all of it", earlier["rows"] == earlier["want"] and allbar == f"{earlier['inFirst']} sowings ticked", {"earlier": earlier, "bar": allbar})
    page.screenshot(path=str(shots / "sowing-earlier.png"))
    js("document.querySelector('.sw-record .btn:not(.primary)').click()"); page.wait_for_timeout(200)

    # varieties of one crop sharing trays: one row above them says so and draws the trays
    js("A.setDate(E.s2d('WEEK0'))"); page.wait_for_timeout(300)
    grp = js("""const f = V.figures(), lines = f.list.filter(l => l.week === 'WEEK0' && l.group && l.state === 'open'), g = lines.length ? lines[0].group : null, mine = g ? lines.filter(l => l.group === g) : [];
      const head = document.querySelector('.view-sow > .sw-wrap > .wk-half > .sw-kind table.sw tr.sw-group');
      return g ? { trays: g.trays, per: g.tray.rows, rows: mine.reduce((n, l) => n + l.batch.rowsSown, 0), lines: mine.length, apart: g.apart, head: head ? head.textContent : '', drawn: head ? head.querySelectorAll('.sw-tray').length : 0,
        cells: head ? head.querySelectorAll('.sw-tray i').length : 0, filled: head ? head.querySelectorAll('.sw-tray i[data-k]').length : 0, slots: mine.map(l => document.querySelector('table.sw tr[data-line="' + l.key + '"] td.sw-how small').textContent),
        tile: document.querySelectorAll('.sw-stats .tr-stat strong')[2].textContent, want: Math.round(f.list.filter(l => l.week === 'WEEK0').reduce((n, l) => n + l.trays, 0)) } : null;""")
    check("varieties of one crop that share trays get one row saying how many trays, with each tray drawn row by row and each line told its rows",
          grp and grp["trays"] < grp["apart"] and f"share {grp['trays']} tray" in grp["head"] and grp["drawn"] == grp["trays"] and grp["cells"] == grp["trays"] * grp["per"] and grp["filled"] == grp["rows"] and all(t.startswith("tray ") for t in grp["slots"]) and grp["tile"] == str(grp["want"]), grp)

    # rockwool for the towers: a sowing alone on its sheets counts them, and the open trays they ride in, on its own line; sowings
    # that share sheets have them counted once, on the row above, and each line is told its sheet and rows. Whichever the plan has
    # is looked at, and both where it has both.
    wool = js("""const f = V.figures(), open = f.list.filter(x => x.kind === 'rockwool' && x.state === 'open'), lone = open.find(x => !x.group), shared = open.find(x => x.group && x.groupLines.length > 1), out = { lone: null, shared: null };
      const how = l => [...document.querySelectorAll('table.sw tr[data-line]')].filter(r => r.dataset.line === l.key).map(r => r.querySelector('td.sw-how'))[0], text = e => e ? e.textContent : '';
      if (lone) { A.setDate(E.s2d(lone.week)); out.lone = { text: text(how(lone) && how(lone).querySelector('span')), sheets: lone.batch.trays, week: lone.week }; }
      if (shared) { A.setDate(E.s2d(shared.week)); const g = shared.group, head = [...document.querySelectorAll('table.sw tr.sw-group')].find(r => r.dataset.group === shared.groupLines[0].key);
        out.shared = { text: text(head && head.querySelector('b')), sheets: g.trays, sowings: shared.groupLines.length, own: text(how(shared) && how(shared).querySelector('small')), week: shared.week }; }
      return out;""")
    check("the plan has a tower sowing still to do, alone on its sheets or sharing them", wool["lone"] or wool["shared"], wool)
    check("the plan has a tower sowing alone on its sheets", bool(wool["lone"]), wool)
    check("the plan has tower sowings that share sheets", bool(wool["shared"]), wool)
    check("a tower sowing says how many rockwool sheets, and that each rides in an open 1020 tray", (wool["lone"] or wool["shared"])
          and (not wool["lone"] or (f"{wool['lone']['sheets']} sheet" in wool["lone"]["text"] and "open 1020 tray" in wool["lone"]["text"]))
          and (not wool["shared"] or (f"{wool['shared']['sowings']} sowings share {wool['shared']['sheets']} sheet" in wool["shared"]["text"] and f"on {wool['shared']['sheets']} open 1020 tray" in wool["shared"]["text"] and wool["shared"]["own"].startswith("sheet "))), wool)
    js("A.setDate(E.s2d('WEEK0'))"); page.wait_for_timeout(300)

    # a day after today is a plan, not a record
    plan = js("""const f = V.figures(), open = f.list.filter(l => l.state === 'open' && !l.set), tp = open.find(l => l.kind === 'plugs' && l.members.length > 1 && l.week >= '2027-04-05'), live = open.find(l => l.kind === 'live' && l.week === (tp && tp.week));
      const need = SL.required(S.engine).rows.reduce((n, x) => n + x.toSow, 0);
      return tp && live ? { week: tp.week, tp: { key: tp.key, ids: tp.members.map(m => m.p.id), date: tp.date, out: E.d2s(tp.members[0].r.field) }, live: { key: live.key, id: live.members[0].p.id, date: live.date, ready: E.d2s(live.members[0].r.first) }, need, undo: S.undo.length, done: S.plan.plantings.filter(p => p.done && p.done.sow).length } : null;""")
    if plan:
        js(f"A.setDate(E.s2d('{plan['week']}'))"); page.wait_for_timeout(300)
        row(plan["tp"]["key"]).locator('input[type="checkbox"]').check(); page.wait_for_timeout(120)
        row(plan["live"]["key"]).locator('input[type="checkbox"]').check(); page.wait_for_timeout(120)
        target = js(f"return E.d2s(E.addDays(E.s2d('{plan['week']}'), 3))")
        page.fill('.sw-record input[type="date"]', target); page.dispatch_event('.sw-record input[type="date"]', "change"); page.wait_for_timeout(250)
        bar2 = js("return { button: document.getElementById('swRecord').textContent, label: document.querySelector('.sw-record label span').textContent, hint: (document.querySelector('.sw-record .sw-later') || {}).textContent || '' }")
        page.click("#swRecord"); page.wait_for_timeout(500)
        planned = js(f"""const tp = {json.dumps(plan["tp"]["ids"])}.map(id => S.engine.planting(id)), live = S.engine.planting({json.dumps(plan["live"]["id"])}), rl = S.engine.calc(live), f = V.figures();
          const lines = f.list.filter(l => l.set && l.date === '{target}');
          return {{ tp: tp.map(p => [p.sowOn, E.d2s(S.engine.calc(p).sow), E.d2s(S.engine.calc(p).field), !!(p.done && p.done.sow)]), live: [live.sowOn, live.date, E.d2s(rl.first), !!(live.done && live.done.sow)], need: SL.required(S.engine).rows.reduce((n, x) => n + x.toSow, 0),
            done: S.plan.plantings.filter(p => p.done && p.done.sow).length, undo: S.undo.length, set: lines.length, tags: document.querySelectorAll('table.sw small.sw-set').length, toast: (document.querySelector('.toast') || {{}}).textContent || '', bar: !!document.querySelector('.sw-record') }};""")
        check("with a later day the button plans instead of recording, and says so", bar2["button"].startswith("Plan 2 sowings for") and bar2["label"] == "Plan for" and "Nothing is marked sown" in bar2["hint"], bar2)
        check("planning moves the sowings to that day in one step: nothing is marked sown, no seed is taken, and the day they go out or are due stays put",
              all(t[0] == target and t[1] == target and t[2] == plan["tp"]["out"] and not t[3] for t in planned["tp"]) and planned["live"][0] == target and planned["live"][1] == target and planned["live"][2] == plan["live"]["ready"] and not planned["live"][3]
              and planned["need"] == plan["need"] and planned["done"] == plan["done"] and planned["undo"] == plan["undo"] + 1 and planned["set"] == 2 and planned["tags"] >= 2 and "nothing marked sown" in planned["toast"] and not planned["bar"], {"planned": planned, "plan": plan, "target": target})
        key2 = js(f"const l = V.figures().list.find(l => l.set && l.kind === 'plugs' && l.date === '{target}'); return l ? l.key : null;")
        row(key2).locator("button.link", has_text="Plan").click(); page.wait_for_timeout(400)
        backed = js(f"""return {{ tp: {json.dumps(plan["tp"]["ids"])}.map(id => [S.engine.planting(id).sowOn || null, E.d2s(S.engine.calc(S.engine.planting(id)).sow)]), undo: S.undo.length }};""")
        check("'Plan’s day' puts a line back on the day the plan works out", all(t[0] is None and t[1] == plan["tp"]["date"] for t in backed["tp"]) and backed["undo"] == plan["undo"] + 2, backed)
        page.keyboard.press("Control+z"); page.keyboard.press("Control+z"); page.wait_for_timeout(400)
    else: check("a week with a shared plug batch and a tray batch exists to plan with", False)

    # undo walks all of it back; a reload keeps what was recorded
    count = js("return S.undo.length") - pick["undo"]
    kept = js("return S.plan.plantings.filter(p => p.done && (p.done.sow || p.done.field)).length")
    page.reload(); ready(); page.click('[data-view-btn="sow"]'); page.wait_for_timeout(400)
    again = js("return { done: S.plan.plantings.filter(p => p.done && (p.done.sow || p.done.field)).length, season: document.querySelectorAll('.sw-stats .tr-stat strong')[5].textContent, save: document.getElementById('saveState').textContent.trim() }")
    check("recorded sowings are still there after the page is reloaded", again["done"] == kept and kept > 0 and not again["season"].startswith("0 of"), {"again": again, "kept": kept})
    wide = js("return { x: document.documentElement.scrollWidth > window.innerWidth, table: [...document.querySelectorAll('.view-sow .tr-scroll')].some(e => e.scrollWidth > e.clientWidth + 1) }")
    check("nothing runs off the side at 1280 wide", not wide["x"] and not wide["table"], wide)
    check("no errors on the page", not errors, errors[:4])
    page.screenshot(path=str(shots / "sowing-view.png"))
    browser.close()
if server: server.shutdown()
print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "results": [r for r in results if not r["ok"]], "undoSteps": count}, indent=1))
sys.exit(1 if failed else 0)
