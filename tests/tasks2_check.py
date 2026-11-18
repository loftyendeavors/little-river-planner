"""Tasks, part 2 (js/sowview.js, the planting's panel, js/app.js) in a real browser, on the made-up farm, on a pretended May 5 of
the plan's year with nothing recorded, so that a long run of tasks is late:
  Upcoming weeks (a line a week, the counts the page's own tasks give, a press goes to that week); Trays to fill (the trays of the
  sowings on screen, falling as one is ticked); "Mark all done" (only on a group of three or more; late ones asked one day, or each
  on its own day, said before it is chosen; one step; Undo gives back the plan exactly); the flag on a planting out whose bed is
  not free (the day it is free, one line that never wraps, also on a phone); a tick a week or more ahead asks first, one within a
  week does not; "⋯", "Take back everything recorded…" (a sheet whose counts are what goes back, a snapshot first, notes kept,
  Undo gives back the plan exactly); "Mark as failed…" on a planting's panel (says before it is done, then its bed is free and its
  harvest is off the forecast, greyed on the Timeline, the mark taken off again); the panel's sowing calendar stops a year short.
Every subject is found on the plan the page was given: nothing here names a crop, a variety, a bed or a number of any plan.
usage: python3 -I tasks2_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280, STOP_AT_FAIL=1
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
# the page's clock: May 5 of the made-up farm's year, with nothing recorded, so that the early season is late
FAKE = "(() => { const R = Date, off = new R(2027, 4, 5, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();"
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, V = LRFSowView, W = LRFWeek, SL = LRFSeedLib, F = LRFForecast, $ = id => document.getElementById(id);"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const now = A.today(), plus = (iso, n) => E.d2s(E.addDays(E.s2d(iso), n)), open = t => t.state === 'open' || t.state === 'part';"
       "const worth = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0), row = key => [...document.querySelectorAll('#swWrap .tk-row')].find(r => r.dataset.line === key) || null;"
       "const figs = ids => Object.fromEntries(ids.map(id => { const e = S.engine, p = e.planting(id), r = p && e.calc(p); return [id, r ? [E.d2s(r.field), E.validDate(r.first) ? E.d2s(r.first) : null] : null]; }));")
def js(page, body, arg=None):
    return page.evaluate("(arg) => { %s %s }" % (PRE, body), arg)
def press(page, selector, ms=350):
    hit = page.locator(selector)
    if not hit.count() or not hit.first.is_visible(): return False
    hit.first.click(timeout=3000); page.wait_for_timeout(ms); return True
def snap(page): return js(page, "return { plan: JSON.stringify(S.plan), undo: S.undo.length };")

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 1000}); ctx.add_init_script(FAKE); page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)
    js(page, "A.setView('sow'); return null;"); page.wait_for_timeout(900)
    start = snap(page)
    nothing = js(page, "return !S.plan.plantings.some(p => p.done && Object.keys(p.done).length) && V.tasks().some(t => open(t) && t.due < now);")
    check("the plan holds nothing recorded, and tasks are late on the pretended day, for the check to work on", nothing)

    # ── Upcoming weeks ──
    up = js(page, """const rows = hooks('tasks-upcoming-week'), cur = LRFTrays.monday(now), all = V.tasks().filter(open);
      return { card: drawn(hook('tasks-upcoming')), below: !!hook('tasks-upcoming') && hook('tasks-upcoming').getBoundingClientRect().top >= $('tkLists').getBoundingClientRect().bottom - 1,
        rows: rows.map((r, i) => { const a = plus(cur, 7 * (i + 1)), z = plus(a, 6), n = h => all.filter(t => t.half === h && t.due >= a && t.due <= z).length;
          const cells = [...r.querySelectorAll('.tk-up-cell')].map(c => { const m = c.textContent.match(/(\\d+) tasks?/); return m ? +m[1] : 0; });
          return { week: r.dataset.week, a, said: cells, want: [n('nursery'), n('field')], pics: r.querySelectorAll('.tk-up-thumb').length }; }) };""")
    check("Upcoming weeks is one card under both lists", up["card"] and up["below"], up)
    check("it has a line for each of the next four weeks, in order", [r["week"] for r in up["rows"]] == [r["a"] for r in up["rows"]] and len(up["rows"]) == 4, up["rows"])
    check("each line's tasks for Nursery and for Field are the page's own open tasks of that week", all(r["said"] == r["want"] for r in up["rows"]), up["rows"])
    check("a line shows the photographs of its varieties, four at most a list", any(r["pics"] > 0 for r in up["rows"]) and all(r["pics"] <= 8 for r in up["rows"]), [r["pics"] for r in up["rows"]])
    page.locator('[data-hook="tasks-upcoming-week"]').nth(1).click(); page.wait_for_timeout(500)
    went = js(page, "return { where: V.where(), want: hooks('tasks-upcoming-week')[1] && hooks('tasks-upcoming-week')[1].dataset.week, pressed: hooks('tasks-upcoming-week')[1] && hooks('tasks-upcoming-week')[1].getAttribute('aria-pressed') };")
    check("a press on a line shows that whole week", went["where"]["day"] is None and went["where"]["week"] == went["want"] and went["pressed"] == "true", went)
    page.screenshot(path=str(shots / "upcoming.png"), full_page=True)
    js(page, "V.show(now); return null;"); page.wait_for_timeout(500)

    # ── Trays to fill ──
    fill = js(page, """const el = hook('tasks-trays-to-fill'), t = el ? el.textContent : '', inNursery = !!el && !!el.closest('[data-half="nursery"]');
      const sow = V.tasks().filter(x => open(x) && x.sow && x.id === 'plugs' && x.due <= now && !x.line.group && x.line.batch && x.line.batch.medium !== 'pots' && x.line.trays >= 1);
      const m = t.match(/(\\d+) trays?/); return { drawn: drawn(el), inNursery, first: el && el.closest('.tk-body') && el.closest('.tk-body').firstElementChild === el, trays: m ? +m[1] : null, text: t, tags: el ? el.querySelectorAll('.tk-fill-sizes span').length : 0, one: sow[0] ? { key: sow[0].key, trays: Math.ceil(sow[0].line.trays - 1e-9) } : null };""")
    check("Trays to fill stands at the head of Nursery, with trays, mix and varieties, and a tag for each tray size", fill["drawn"] and fill["inNursery"] and fill["first"] and fill["trays"] and "mix" in fill["text"] and "variet" in fill["text"] and fill["tags"] >= 1, fill)
    check("there is a sowing in plug trays on screen, of its own trays, to tick for the check", fill["one"], fill)
    if fill["one"]:
        before = snap(page)
        js(page, "const t = V.tasks().find(x => x.key === arg); A.recordWork(t.items(), { date: t.due, follow: true }); return null;", fill["one"]["key"]); page.wait_for_timeout(600)
        fell = js(page, "const el = hook('tasks-trays-to-fill'), m = el && el.textContent.match(/(\\d+) trays?/); return m ? +m[1] : null;")
        check("Trays to fill falls by that sowing's trays once it is ticked", fell == fill["trays"] - fill["one"]["trays"], {"was": fill["trays"], "now": fell, "sowing": fill["one"]})
        js(page, "A.undo(); return null;"); page.wait_for_timeout(500)
        check("Undo of that tick gives back the plan exactly", snap(page)["plan"] == before["plan"])

    # ── Mark all done ──
    groups = js(page, """return [...document.querySelectorAll('#swWrap .tk-sec')].map(s => ({ name: (s.querySelector('.tk-sec-name') || {}).textContent, n: +((s.querySelector('.tk-sec-n') || {}).textContent || '0').split(' ')[0].replace(/,/g, ''), all: !!s.querySelector('[data-hook="tasks-mark-all"]'), half: s.closest('[data-half]') && s.closest('[data-half]').dataset.half }));""")
    check("every Late or Today group of three or more has Mark all done, and none of fewer has it",
          all(g["all"] == (g["n"] >= 3) for g in groups if g["name"] in ("Late", "Today")) and any(g["all"] for g in groups), groups)
    late = page.locator('[data-half="field"] .tk-sec.late [data-hook="tasks-mark-all"]')
    keys = json.loads(late.first.get_attribute("data-keys")) if late.count() else []
    check("the Field list has a late group with Mark all done, for the check", len(keys) >= 3, groups)
    if keys:
        before = snap(page)
        ids = js(page, "return [...new Set(arg.flatMap(k => V.tasks().find(t => t.key === k).items().map(i => i.id)))];", keys)
        figs0 = js(page, "return figs(arg);", ids)
        late.first.click(); page.wait_for_timeout(500)
        pop = js(page, "const p = $('tkPop'); return { open: !p.hidden, title: (p.querySelector('strong') || {}).textContent, today: !!p.querySelector('.tk-quick button[data-pick=\"' + now + '\"]'), each: drawn(hook('tasks-mark-all-each')), where: V.where().pop };")
        check("Mark all done on late tasks asks one day for all of them, or each on its own day", pop["open"] and pop["where"] == "all" and pop["today"] and pop["each"] and "were they done" in (pop["title"] or ""), pop)
        page.hover('[data-hook="tasks-mark-all-each"]'); page.wait_for_timeout(200)
        hint = js(page, "return $('tkHint').textContent;")
        check("pointed at, each on its own day says that nothing moves", "nothing moves" in hint, hint)
        page.hover('#tkPop .tk-quick button[data-pick]'); page.wait_for_timeout(300)
        hint_today = js(page, "return $('tkHint').textContent;")
        pre = js(page, "const list = arg.map(k => V.tasks().find(t => t.key === k)); const p = A.previewWork(list.flatMap(t => t.items()), { date: now, follow: true }, { impact: false, firsts: true }); return { moved: p.moved.length, firsts: p.firsts.length };", keys)
        check("pointed at, today says how many plantings go out later and how many first harvests move, as the plan works it out",
              ((pre["moved"] == 0 and "go out" not in hint_today) or (str(pre["moved"]) + " planting") in hint_today) and ((pre["firsts"] == 0 and "first harvest" not in hint_today) or (str(pre["firsts"]) + " first harvest") in hint_today) and (pre["moved"] + pre["firsts"] > 0 or "nothing moves" in hint_today), {"hint": hint_today, "said": pre})
        press(page, '[data-hook="tasks-mark-all-each"]', 800)
        after = js(page, "return { figs: figs(arg.ids), done: arg.keys.map(k => { const t = V.tasks().find(x => x.key === k); return t ? [t.state, t.on, t.due] : null; }), undo: S.undo.length, toast: $('toast').textContent };", {"ids": ids, "keys": keys})
        check("each on its own day records every one of them on the day it was due", all(d and d[0] == "done" and d[1] == d[2] for d in after["done"]), after["done"][:4])
        check("and nothing moves: the day each planting goes out and its first harvest are as they were", after["figs"] == figs0, {"before": list(figs0.items())[:2], "after": list(after["figs"].items())[:2]})
        check("it is one step, said once with Undo", after["undo"] == before["undo"] + 1 and "recorded each on the day it was due" in after["toast"], after["toast"])
        js(page, "A.undo(); return null;"); page.wait_for_timeout(600)
        check("Undo gives back the plan exactly", snap(page)["plan"] == before["plan"])
        # the same on one day, today: what it moves is what it said
        late.first.click(); page.wait_for_timeout(400); press(page, '#tkPop .tk-quick button[data-pick]', 900)
        moved = js(page, "return arg.ids.filter(id => { const a = arg.was[id], e = S.engine, p = e.planting(id), r = p && e.calc(p); return a && r && a[1] !== (E.validDate(r.first) ? E.d2s(r.first) : null); }).length;", {"ids": ids, "was": figs0})
        check("on one day, today, as many first harvests move as it said", moved == pre["firsts"], {"moved": moved, "said": pre})
        js(page, "A.undo(); return null;"); page.wait_for_timeout(600)
        check("and Undo gives that back exactly too", snap(page)["plan"] == before["plan"])
    today = page.locator('.tk-sec:not(.late) [data-hook="tasks-mark-all"]')
    if today.count():
        before = snap(page); tkeys = json.loads(today.first.get_attribute("data-keys"))
        today.first.click(); page.wait_for_timeout(800)
        rec = js(page, "return { pop: V.where().pop, done: arg.map(k => { const t = V.tasks().find(x => x.key === k); return t && t.state === 'done' && t.on === now; }) };", tkeys)
        check("Mark all done on Today records them at once, today, without asking", rec["pop"] is None and all(rec["done"]), rec)
        js(page, "A.undo(); return null;"); page.wait_for_timeout(500)
        check("Undo gives back the plan exactly", snap(page)["plan"] == before["plan"])
    else: check("a Today group of three or more is there for the check", False, groups)

    # ── the flag on a planting out whose bed is not free ──
    held = js(page, """for (const t of V.tasks()) {
        if (!open(t) || (t.id !== 'plant' && t.id !== 'direct') || t.due < now) continue;
        for (const m of t.line.open) { const hit = S.engine.conflicts(m.p, m.r).filter(o => !o.rest && o.p && o.from < m.r.field && o.through >= m.r.field && o.through !== Infinity);
          if (hit.length) return { key: t.key, due: t.due, free: E.d2s(E.addDays(new Date(Math.max(...hit.map(o => +o.through))), 1)) }; }
      } return null;""")
    check("the plan has a planting out or a sowing in the ground whose bed another planting still holds that day, for the check", held)
    if held:
        js(page, "V.show(arg); return null;", held["due"]); page.wait_for_timeout(600)
        fl = js(page, "const r = row(arg.key), f = r && r.querySelector('.tk-flag'), cs = f && getComputedStyle(f); return { text: f ? f.textContent : '', h: f ? f.getBoundingClientRect().height : 0, lh: cs ? parseFloat(cs.lineHeight) || 17 : 0, wrap: cs ? cs.whiteSpace : '', free: arg.free, day: LRFUI.day(E.s2d(arg.free)) };", held)
        check("its row is flagged with the day its bed is free", fl["text"].startswith("Bed not free until") and fl["day"] in fl["text"], fl)
        check("the flag is one line that does not wrap", fl["wrap"] == "nowrap" and fl["h"] <= fl["lh"] * 1.5 + 1, fl)
        page.screenshot(path=str(shots / "flag.png"))
        js(page, "V.show(now); return null;"); page.wait_for_timeout(400)

    # ── a tick a week or more ahead asks first; within a week it does not ──
    ahead = js(page, "const far = V.tasks().find(t => open(t) && t.due >= plus(now, 9) && t.due <= plus(now, 40) && t.id !== 'live'), near = V.tasks().find(t => open(t) && t.due > now && t.due <= plus(now, 5) && t.id !== 'live'); return far && near ? { far: far.key, farDue: far.due, farItems: far.items(), near: near.key, nearDue: near.due, nearItems: near.items() } : null;")
    check("the plan has a task nine days or more ahead and one within the week, for the check", ahead)
    if ahead:
        before = snap(page)
        js(page, "V.show(arg); return null;", ahead["farDue"]); page.wait_for_timeout(500)
        page.locator('#swWrap .tk-row[data-line="%s"] .tk-tick' % ahead["far"].replace('"', '\\"')).first.click(); page.wait_for_timeout(500)
        asked = js(page, "const p = $('tkPop'); return { open: !p.hidden, mode: V.where().pop, text: p.textContent, recorded: S.undo.length };")
        days = js(page, "return E.dayDiff(E.s2d(arg), E.s2d(now));", ahead["farDue"])
        check("a tick a week or more ahead asks first, and says how far ahead it is", asked["open"] and asked["mode"] == "ahead" and ("in %d days" % days) in asked["text"] and asked["recorded"] == before["undo"], asked)
        press(page, '[data-hook="tasks-ahead-no"]', 400)
        check("Not yet records nothing", snap(page)["plan"] == before["plan"])
        page.locator('#swWrap .tk-row[data-line="%s"] .tk-tick' % ahead["far"].replace('"', '\\"')).first.click(); page.wait_for_timeout(400)
        press(page, '[data-hook="tasks-ahead-yes"]', 1300)
        did = js(page, "return arg.map(i => SL.doneDate(S.engine.planting(i.id), i.kind));", ahead["farItems"])
        check("Record it today records it as done today", did and all(x == js(page, "return now;") for x in did), did)
        js(page, "A.undo(); return null;"); page.wait_for_timeout(500)
        js(page, "V.show(arg); return null;", ahead["nearDue"]); page.wait_for_timeout(500)
        page.locator('#swWrap .tk-row[data-line="%s"] .tk-tick' % ahead["near"].replace('"', '\\"')).first.click(); page.wait_for_timeout(1300)
        near = js(page, "return { pop: V.where().pop, done: arg.map(i => SL.doneDate(S.engine.planting(i.id), i.kind)) };", ahead["nearItems"])
        check("a tick within the week records at once, without asking", near["pop"] is None and all(x == js(page, "return now;") for x in near["done"]), near)
        js(page, "A.undo(); return null;"); page.wait_for_timeout(500)
        check("Undo gives back the plan exactly", snap(page)["plan"] == before["plan"])
        js(page, "V.show(now); return null;"); page.wait_for_timeout(400)

    # ── "⋯": take back everything recorded ──
    before = snap(page)
    # seed on hand for the first late sowing in plug trays, put there through the page's own step where the plan has none, so that its return can be seen
    js(page, """const t = V.tasks().find(t => open(t) && t.due < now && t.sow && t.id === 'plugs'); if (!t || SL.lotsToUse(A.inventoryNow(), t.line.stockKey, t.line.stockUnit).length) return null;
      A.editStock('Seed counted', (inv, c) => SL.addLot(inv, { key: t.line.stockKey, unit: t.line.stockUnit, quantity: 5000, status: 'usable' }, c)); return null;""")
    seed0 = js(page, "return JSON.stringify((A.inventoryNow().lots || []).map(l => [l.id, l.quantity]));")
    made = js(page, """const late = V.tasks().filter(t => open(t) && t.due < now);
      const inv = A.inventoryNow(), stocked = t => SL.lotsToUse(inv, t.line.stockKey, t.line.stockUnit).length > 0;
      const sows = late.filter(t => t.sow && t.id === 'plugs' && stocked(t)).slice(0, 2).concat(late.filter(t => t.sow && t.id === 'plugs' && !stocked(t)).slice(0, 1)), jobs = late.filter(t => !t.sow && t.id === 'plant').slice(0, 2), later = V.tasks().filter(t => open(t) && t.due > plus(now, 3) && !t.sow);
      A.recordWork(sows.flatMap(t => t.items()), { date: now, follow: true }); A.recordWork(jobs.flatMap(t => t.items()), { date: now, follow: true });
      const put = later.find(t => t.id === 'potup' || t.id === 'move' || t.id === 'harden'), skip = later.find(t => t !== put);
      if (put) A.delayWork(put.items(), plus(put.due, 2)); if (skip) A.skipWork(skip.items(), now);
      const note = V.tasks().find(t => open(t) && t !== put && t !== skip); A.noteWork(note.items(), 'kept note');
      return { n: A.seasonRecords(), note: note.items().map(i => i.id), seed: JSON.stringify((A.inventoryNow().lots || []).map(l => [l.id, l.quantity])) };""")
    recorded = snap(page)
    check("the sowings recorded took seed off its lots, for the check of its return", made["seed"] != seed0)
    check("sowings, other tasks, a task put off, one skipped and a note are recorded through the page's own steps, for the check", made["n"]["sowings"] >= 1 and made["n"]["jobs"] >= 1 and made["n"]["delays"] >= 1 and made["n"]["skips"] >= 1, made["n"])
    press(page, '[data-hook="tasks-more"]', 400)
    menu = js(page, "const b = hook('tasks-takeback'); return { pop: V.where().pop, drawn: drawn(b), off: b ? b.disabled : null };")
    check("\"⋯\" at the top of Tasks opens a menu with Take back everything recorded…", menu["pop"] == "more" and menu["drawn"] and menu["off"] is False, menu)
    press(page, '[data-hook="tasks-takeback"]', 500)
    sheet = js(page, "const d = hook('tasks-takeback-sheet'); return { open: !!d && d.open, text: d ? d.textContent : '', lines: d ? [...d.querySelectorAll('li')].map(li => li.textContent) : [] };")
    n = made["n"]
    want = ["%d sowing" % n["sowings"], "%d other task" % n["jobs"], "%d task" % n["delays"], "%d skipped task" % n["skips"]]
    check("the sheet counts what goes back: sowings, other tasks, what was put off and what was skipped", sheet["open"] and all(any(w in l for l in sheet["lines"]) for w in want), {"want": want, "lines": sheet["lines"]})
    check("the sheet says notes stay, and that a snapshot is kept first", "note" in " ".join(sheet["lines"]) and "snapshot" in sheet["text"].lower(), sheet["text"][:400])
    page.screenshot(path=str(shots / "takeback-sheet.png"))
    page.locator('[data-hook="tasks-takeback-sheet"] .btn:not(.primary)').click(); page.wait_for_timeout(400)
    check("Cancel takes nothing back", snap(page)["plan"] == recorded["plan"])
    snaps0 = page.evaluate("async () => (await LRFApp.snapshots()).rows.length")
    press(page, '[data-hook="tasks-more"]', 400); press(page, '[data-hook="tasks-takeback"]', 500); press(page, '[data-hook="tasks-takeback-yes"]', 1500)
    back = js(page, """const rec = S.plan.plantings.filter(p => (p.done && Object.keys(p.done).length) || (p.tasks && (p.tasks.delay || p.tasks.skip))).length;
      return { rec, n: A.seasonRecords(), notes: arg.map(id => S.engine.planting(id).tasks && S.engine.planting(id).tasks.note), seed: JSON.stringify((A.inventoryNow().lots || []).map(l => [l.id, l.quantity])), undo: S.undo.length };""", made["note"])
    snaps1 = page.evaluate("async () => (await LRFApp.snapshots()).rows.map(s => s.name)")
    dates = js(page, "const e0 = E.create(JSON.parse(arg), LRFLibrary); return S.plan.plantings.filter(p => { const q = e0.planting(p.id), a = q && e0.calc(q), b = S.engine.calc(p); return a && b && [a.sow, a.field, a.first, a.last].map(String).join() !== [b.sow, b.field, b.first, b.last].map(String).join(); }).length;", before["plan"])
    check("everything recorded is taken back: no work, nothing put off, nothing skipped", back["rec"] == 0 and back["n"]["sowings"] + back["n"]["jobs"] + back["n"]["delays"] + back["n"]["skips"] == 0, back)
    check("every planting is back on the days it had before anything was recorded, and the seed is back on its lots", dates == 0 and back["seed"] == seed0, {"dates": dates})
    check("the note is kept", all(x and "kept note" in json.dumps(x) for x in back["notes"]), back["notes"])
    check("a snapshot of the plan as it stood was kept first", len(snaps1) == snaps0 + 1 and any("taken back" in s for s in snaps1), snaps1[:3])
    check("it is one step", back["undo"] == recorded["undo"] + 1)
    js(page, "A.undo(); return null;"); page.wait_for_timeout(700)
    check("Undo gives back the plan as it was recorded, exactly", snap(page)["plan"] == recorded["plan"])
    for _ in range(recorded["undo"] - before["undo"]): js(page, "A.undo(); return null;"); page.wait_for_timeout(250)
    check("and the steps before it undo back to the plan the check began on", snap(page)["plan"] == before["plan"])

    # ── Mark as failed, on a planting's panel ──
    subj = js(page, """const e = S.engine;
      const p = S.plan.plantings.find(p => { const r = e.calc(p); return r && !p.established && !r.rack && !r.ct && E.d2s(r.start) < plus(now, -10) && r.harvestDays > 10 && E.d2s(r.first) > now && e.occupancyThrough(p, r) !== Infinity && A.failedRange(p); });
      const ahead = S.plan.plantings.find(p => { const r = e.calc(p); return r && !p.established && E.d2s(r.start) > now; });
      return p && ahead ? { id: p.id, ahead: ahead.id, held: E.d2s(e.occupancyThrough(p, e.calc(p))) } : null;""")
    check("the plan has a planting already started and still to be picked, and one not yet started, for the check", subj)
    if subj:
        before = snap(page)
        js(page, "A.setView('map'); A.select({ type: 'planting', id: arg }); return null;", subj["ahead"]); page.wait_for_timeout(600)
        check("a planting not started yet has no Mark as failed…", not js(page, "return drawn(hook('panel-fail'));"))
        js(page, "A.select({ type: 'planting', id: arg }); return null;", subj["id"]); page.wait_for_timeout(600)
        check("a planting already started has Mark as failed… on its panel", js(page, "return drawn(hook('panel-fail')) && !!hook('panel-fail').closest('#inspectorBody');"))
        press(page, '[data-hook="panel-fail"]', 500)
        box = js(page, "const d = hook('panel-fail-date'), s = hook('panel-fail-says'); return { date: d ? d.value : null, max: d ? d.max : null, min: d ? d.min : null, says: s ? s.textContent : '', want: A.previewFailed(arg, now) };", subj["id"])
        check("it opens on today, and can go no later than today", box["date"] == js(page, "return now;") and box["max"] == box["date"] and box["min"] <= box["date"], box)
        check("before anything is done it says the day its bed is free, what comes off the forecast, and that it stays on record",
              "free from " in box["says"] and "off the forecast" in box["says"] and "on record" in box["says"] and box["want"]["units"] > 0 and box["want"]["worth"] > 0, box)
        check("nothing has changed yet", snap(page)["plan"] == before["plan"])
        w0 = js(page, "return worth(S.engine);")
        press(page, '[data-hook="panel-fail-save"]', 900)
        did = js(page, "const p = S.engine.planting(arg), r = S.engine.calc(p); return { failed: p.failed, held: E.d2s(S.engine.occupancyThrough(p, r)), harvest: r.harvestDays, worth: worth(S.engine), panel: drawn(hook('panel-failed')), back: drawn(hook('panel-failed-back')), undo: S.undo.length };", subj["id"])
        today = js(page, "return now;")
        check("marked failed today: the day is kept on the planting", did["failed"] and did["failed"]["on"] == today, did)
        check("its bed is free from today", did["held"] == js(page, "return plus(now, -1);"), did)
        check("its harvest is off the forecast: the season's worth falls by what was said", abs((w0 - did["worth"]) - box["want"]["worth"]) < 0.5 and did["harvest"] == 0, {"was": w0, "now": did["worth"], "said": box["want"]["worth"]})
        check("its panel says it failed, with Take the mark off, and it is one step", did["panel"] and did["back"] and did["undo"] == before["undo"] + 1, did)
        js(page, "A.setView('timeline'); return null;"); page.wait_for_timeout(900)
        grey = js(page, "const b = document.querySelector('.tl-bar[data-planting=\"' + arg + '\"]'); return b ? { cls: b.className, title: b.title } : null;", subj["id"])
        check("it stays on record, greyed, on the Timeline", grey and "tl-failed" in grey["cls"] and grey["title"].startswith("Failed"), grey)
        js(page, "A.setView('map'); A.select({ type: 'planting', id: arg }); return null;", subj["id"]); page.wait_for_timeout(500)
        page.screenshot(path=str(shots / "failed-panel.png"))
        press(page, '[data-hook="panel-failed-back"]', 700)
        off = js(page, "const p = S.engine.planting(arg); return { failed: p.failed || null, held: E.d2s(S.engine.occupancyThrough(p, S.engine.calc(p))) };", subj["id"])
        check("Take the mark off puts it back in its bed for its whole season", off["failed"] is None and off["held"] == subj["held"], off)
        js(page, "A.undo(); A.undo(); return null;"); page.wait_for_timeout(600)
        check("Undo of both steps gives back the plan exactly", snap(page)["plan"] == before["plan"])
        # the sowing calendar on the panel stops a year short of the planned day
        cal = js(page, "const p = S.plan.plantings.find(p => { const s = SL.sowing(S.engine, p); return s && !s.done && !s.sown && E.validDate(s.planned) && E.d2s(s.planned) <= now; }); if (!p) return null; A.select({ type: 'planting', id: p.id }); const s = SL.sowing(S.engine, p); return { id: p.id, want: plus(E.d2s(s.planned), 1 - SL.YEAR_DAYS) };")
        page.wait_for_timeout(500)
        if cal:
            got = js(page, "const i = document.querySelector('#inspectorBody [data-sow=\"date\"]'); return i ? i.min : null;")
            check("the panel's sowing calendar goes back no further than a year before its planned day", got == cal["want"], {"min": got, "want": cal["want"]})
        else: check("a sowing still to record is there for the calendar's check", False)

    # ── on a phone ──
    phone = browser.new_context(viewport={"width": 390, "height": 844}); phone.add_init_script(FAKE); pp = phone.new_page()
    pp.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pp.goto(url); pp.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    if backup and pp.evaluate("LRFApp.isSample()"):
        pp.set_input_files("#importFile", backup); pp.wait_for_timeout(400)
        if pp.locator("dialog[open] .btn.primary").count(): pp.locator("dialog[open] .btn.primary").click()
        pp.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); pp.wait_for_timeout(1500)
    pp.wait_for_timeout(800)
    ph = pp.evaluate("""() => { const W = document.documentElement.clientWidth, wide = [...document.querySelectorAll('#swWrap *')].filter(el => el.getClientRects().length && el.getBoundingClientRect().right > W + 1).length;
      const up = document.querySelector('[data-hook="tasks-upcoming"]'), flags = [...document.querySelectorAll('.tk-flag')].map(f => [f.getBoundingClientRect().height, parseFloat(getComputedStyle(f).lineHeight) || 17]);
      return { phone: document.body.classList.contains('phone'), wide, up: !!up && up.getClientRects().length > 0, flags, more: !!document.querySelector('[data-hook="tasks-more"]') }; }""")
    check("on a phone, Tasks has Upcoming weeks and \"⋯\", and nothing runs off the side", ph["phone"] and ph["up"] and ph["more"] and ph["wide"] == 0, ph)
    check("on a phone, every flag is one line", all(h <= lh * 1.5 + 1 for h, lh in ph["flags"]), ph["flags"])
    pp.screenshot(path=str(shots / "phone.png"), full_page=True)
    browser.close()

with sync_playwright() as pw:
    try: run(pw)
    except Exception as e: check("the check ran to its end", False, repr(e)[:600])
check("no error on the page", not [e for e in errors if "pageerror" in e], errors[:4])
finish()
