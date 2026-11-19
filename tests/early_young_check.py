"""E2c part 2 in a real browser, on the made-up farm: something a crop sells first picked days before the crop's own days to
harvest, and a cane stand by its age, through the page's own controls.
  The crop's card (Assumptions, Yield and price): in a column for something else it sells, First picking holds a box for days
  before, empty and not amber, saying it is picked with the crop; typed, one step, the plan holds it, no date moves, the forecast is
  the one worked out on a copy of the plan changed by hand, the message gives the season's worth, the line under the box says what
  it comes to; too many days are refused in a sentence. A planting grown for it says when it is first picked in its Schedule and in
  its row of the bed's season; the Forecast's popup tags it.
  A perennial crop's card has a row for a young stand: grey published figures (each box says whose, and for what kind of grower),
  counted only once a stand's year is typed; his own replaces one. A stand's panel has "Stand planted in" with its "?": typed, one
  step, the message and the Expected line say its season and share and the season's worth, as the engine works it out on a copy; a
  year after the season is refused; the same box in its row of the bed's season empties it again; the Forecast's popup tags it.
  Undo takes back every step.
The cases are added to the plan the page holds, never to the farm. Every subject is found on the plan the page was given by the
engine's own figures: nothing here names a crop, a variety, a bed or a number of any plan.
usage: python3 -I early_young_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, HV = LRFHarvestView, UI = LRFUI, $ = id => document.getElementById(id);"
       "const hook = (name, el) => (el || document).querySelector(`[data-hook=\"${name}\"]`), hooks = (name, el) => [...(el || document).querySelectorAll(`[data-hook=\"${name}\"]`)];"
       "const txt = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';"
       "const worthOf = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0), money = n => '$' + Math.round(n).toLocaleString('en-US');"
       "const copy = () => JSON.parse(JSON.stringify(S.plan)), engineOf = plan => E.create(plan, LRFLibrary);"
       "const toast = () => txt(document.querySelector('#toast span'));"
       "const snap = () => ({ key: A.contentKey(), undo: S.undo.length, plan: JSON.stringify({ ...S.plan, lrfNext: null }) });"
       # every planting's dates and ground: what must not move
       "const dates = e => e.plan.plantings.map(p => { const r = e.calc(p); return r ? [p.id, E.d2s(r.field), E.d2s(r.first), E.d2s(r.last), r.harvestDays, String(+e.occupancyThrough(p, r))].join('|') : p.id; }).join('\\n');"
       "const rowsOf = e => F.build(e).rows.map(r => [r.key, r.total.toFixed(9), r.worth.toFixed(9), Array.from(r.days, v => v.toFixed(9)).join(',')].join('|')).join('\\n');"
       "const days = (a, b) => Math.round(E.dayDiff(a, b));"
       "const typeIn = (el, v) => { if (!el) return false; el.focus(); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
    page.evaluate("LRFApp.state.undo.length = 0")
    def js(body, arg=None): return page.evaluate("(arg) => { " + PRE + body + " }", arg)
    def wait(ms): page.wait_for_timeout(ms)
    def shot(name): page.screenshot(path=str(shots / f"{name}.png"))
    def close_dialogs(): js("for (const d of document.querySelectorAll('dialog[open]')) { const b = d.querySelector('.btn.primary'); if (b) b.click(); } return 1;"); wait(300)
    def popup_tags(crop, thing, pid, before_first, go=False):
        """Open the Forecast's popup on a week the planting gives in (before its own first picking when asked) and give its row's tags."""
        js("A.setView('harvest'); return 1;"); wait(600)
        btn = page.locator('[data-hook="fc-season-btn"]')
        if btn.count() and btn.get_attribute("aria-pressed") != "true": btn.click(); wait(600)
        at = js("""const m = HV.model(), t = hook('fc-table'), keys = [...t.querySelectorAll('thead th[data-col]')].map(th => th.dataset.col), cols = new Map(F.periods(m, 'week').map(c => [c.key, c]));
          const trs = [...t.querySelectorAll('tbody tr.hv-row')], ri = trs.findIndex(tr => tr.dataset.crop === arg.crop && (tr.dataset.thing || '') === arg.thing); if (ri < 0) return null;
          const row = m.rows.find(r => r.cropId === arg.crop && (r.thing || '') === arg.thing), q = row && row.plantings.find(x => x.p.id === arg.pid); if (!q) return null;
          const ci = keys.findIndex(k => { const c = cols.get(k); return c && F.share(q, c.i0, c.i1) > 1e-9 && (!arg.early || c.i1 < m.index(q.r.first)); });
          return ci < 0 ? null : { ri, ci };""", {"crop": crop, "thing": thing, "pid": pid, "early": before_first})
        if not at: return None
        page.locator('[data-hook="fc-table"] tbody tr.hv-row').nth(at["ri"]).locator("td.hv-c").nth(at["ci"]).click(); wait(600)
        tags = js("const d = hook('fc-from'); if (!d) return null; const li = hooks('fc-from-row', d).find(x => x.dataset.planting === arg); return li ? hooks('fc-tag', li).map(x => [x.dataset.tag, txt(x)]) : [];", pid)
        if go:
            # "Show on the map" goes to the day it is first picked: a thing's own first picking, days before its crop's
            js("A.setDate(new Date(A.planYear(), 0, 2)); const d = hook('fc-from'), li = d && hooks('fc-from-row', d).find(x => x.dataset.planting === arg); const b = li && li.querySelector('button.link'); if (b) b.click(); return 1;", pid); wait(500)
            return tags, js("const f = document.querySelector(`#mapBeds .bed-fill[data-planting=\"${arg}\"]`); return { date: E.d2s(S.date), view: S.view, sel: S.sel && S.sel.id, picking: !!f && f.classList.contains('pick') };", pid)
        js("const d = document.querySelector('dialog[open]'); if (d) { d.close(); d.remove(); } return 1;"); wait(200)
        return tags
    start = js("return snap();")

    # ── the subject for days before: a crop with three plantings at least in beds that follow its line, picked over days ──
    sub = js("""const eng = S.engine, by = new Map();
      for (const p of S.plan.plantings) { const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null, b = r && r.b;
        if (!y || y.own || !y.set || !(y.units > 0) || !b || !eng.isSoilBed(b) || r.harvestDays < 3 || days(r.first, r.field) < 12 || p.gives || eng.isPerennial(r.c) || eng.thingsOf(p.cropId).length) continue;
        by.set(p.cropId, [...(by.get(p.cropId) || []), p]); }
      const [crop, list] = [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
      if (!crop) return null;
      const room = Math.min(...list.map(p => days(eng.calc(p).first, eng.calc(p).field))) - 1;
      return { crop, name: eng.crop(crop).name, p0: list[0].id, p1: list[1].id, n: list.length, room, N: Math.max(2, Math.min(9, room - 1)), unit: eng.unitOf(eng.crop(crop)) };""")
    check("a subject: a crop of three plantings at least in beds, following its line, picked over days, with room before its first picking", sub and sub["n"] >= 3 and sub["N"] >= 2, sub)
    if not sub: finish()
    T, N, C, P0 = "t-early-check", sub["N"], sub["crop"], sub["p0"]
    js("""const before = S.plan.assumptions || null, after = before ? JSON.parse(JSON.stringify(before)) : { v: 1, crops: {}, varieties: {} };
      after.sell = after.sell || {}; after.sell[arg.C] = { ...(after.sell[arg.C] || {}), things: { [arg.T]: { id: arg.T, n: 1, name: 'Early ones', from: 'bed', unit: arg.unit, price: 3, pattern: 'spread', share: 30, yield: 0.5, days: 5 } } };
      A.commit('a thing out of each bed, for the check', [{ kind: 'assume', before, after }], { unchecked: true }); A.setGives(arg.P0, arg.T); return 1;""", {"C": C, "T": T, "P0": P0, "unit": sub["unit"]}); wait(500)
    set0 = js("const t = S.engine.thingsOf(arg.C).find(x => x.id === arg.T), p = S.engine.planting(arg.P0); return { counts: !!t && t.counts, gives: p.gives };", {"C": C, "T": T, "P0": P0})
    check("the case: a thing out of each bed that counts, and one planting grown for it alone", set0["counts"] and set0["gives"] == T, set0)
    js("A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg); return 1;", C); wait(700)
    cell = lambda: js("""const td = document.querySelector(`#ycGrid tr[data-row="first"] td.yc-thing[data-thing="${arg}"]`), box = td && td.querySelector('input[data-yk]');
      return td ? { yk: box ? box.dataset.yk : null, value: box ? box.value : null, placeholder: box ? box.placeholder : null, amber: !!(box && box.closest('.yc-box.amber')), mine: !!(box && box.closest('.yc-box.mine')), label: box ? box.getAttribute('aria-label') : '', tip: box ? box.title : '', said: txt(hook('thing-first-said', td)), text: txt(td) } : null;""", T)
    c0 = cell()
    check("the crop's card: its First picking row has, in the thing's column, a box for days before, empty and not amber, 0 in grey (picked with the crop), and says it is his to fill", c0 and c0["yk"] == f"t|{T}|before" and c0["value"] == "" and c0["placeholder"] == "0" and not c0["amber"] and c0["said"] == "" and "days before" in c0["label"] and "days before" in c0["text"] and "Only you can fill this" in c0["tip"] and "Empty: picked with" in c0["tip"], c0)
    shot("card-empty")
    s1 = js("return snap();"); d1 = js("return dates(S.engine);")
    js("return typeIn(document.querySelector(`[data-yk=\"t|${arg}|before\"]`), %d);" % N, T); wait(600); close_dialogs()
    got = js("""const t = S.plan.assumptions.sell[arg.C].things[arg.T], eng = S.engine, p = eng.planting(arg.P0), r = eng.calc(p), part = (eng.soldOf(p, r) || []).find(x => x.thing === arg.T);
      const want = copy(); delete want.assumptions.sell[arg.C].things[arg.T].before; want.assumptions.sell[arg.C].things[arg.T].before = arg.N;
      return { before: t.before, undo: S.undo.length, dates: dates(eng), first: part ? E.d2s(part.first) : null, want: part ? E.d2s(E.addDays(r.first, -arg.N)) : null, rows: rowsOf(eng) === rowsOf(engineOf(want)), worth: worthOf(eng), toast: toast(), unit: r.c.name };""", {"C": C, "T": T, "P0": P0, "N": N})
    check("typed, one step: the plan holds the days before on the thing, and nothing else changed", got["before"] == N and got["undo"] == s1["undo"] + 1, got)
    check("no planting's dates or ground move", got["dates"] == d1)
    check("the planting grown for it is first picked that many days before its own first picking", got["first"] and got["first"] == got["want"], got)
    check("the forecast is the one worked out on a copy of the plan changed by hand", got["rows"] is True)
    check("the message says what was done and the season's worth, with Undo", f"first picked {N} days before" in got["toast"] and "season’s worth" in got["toast"] and page.locator("#toast button").count() > 0, got["toast"])
    c1 = cell()
    check("the box is his now, and the line under it says what it comes to", c1 and c1["mine"] and c1["value"] == str(N) and ("first picked at" in c1["said"] or f"first picked {N} days before" in c1["said"]), c1)
    shot("card-typed")
    s2 = js("return snap();")
    js("return typeIn(document.querySelector(`[data-yk=\"t|${arg}|before\"]`), 3000);", T); wait(500); close_dialogs()
    big = js("""const eng = S.engine, fed = S.plan.plantings.map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && x.r.harvestDays > 0 && (eng.soldOf(x.p, x.r) || []).some(q => q.thing === arg));
      return { toast: toast(), snap: snap(), room: Math.min(...fed.map(x => days(x.r.first, x.r.field))) - 1 };""", T)
    check("more days before than a planting it comes from is in its bed are refused in a sentence that says how many it can take; nothing changes", "cannot be first picked 3000 days" in big["toast"] and f"Type {max(1, big['room'])} or fewer" in big["toast"] and big["snap"]["plan"] == s2["plan"], [big["toast"], big["room"]])
    # a thing from one place: the line under its box says the days it comes to, against its crop's, exactly
    js("""const before = S.plan.assumptions, after = JSON.parse(JSON.stringify(before)), eng = S.engine, env = eng.envOf(eng.bedOf(eng.planting(arg.P0).bedId));
      after.sell[arg.C].things['t-place-check'] = { id: 't-place-check', n: 3, name: 'Place ones', from: 'place', place: env, unit: arg.unit, price: 2, pattern: 'spread', yield: 0.5, before: arg.N };
      A.commit('a thing from one place, for the check', [{ kind: 'assume', before, after }], { unchecked: true }); return 1;""", {"C": C, "P0": P0, "N": N, "unit": sub["unit"]}); wait(500)
    pl = js("""const eng = S.engine, env = eng.envOf(eng.bedOf(eng.planting(arg.P0).bedId)), d = eng.timingFor(arg.C, null, env).value, td = document.querySelector('#ycGrid tr[data-row="first"] td.yc-thing[data-thing="t-place-check"]');
      return { said: td ? txt(hook('thing-first-said', td)) : null, want: `first picked at ${Math.max(1, d - arg.N)} days, ${eng.crop(arg.C).name} at ${d}` };""", {"C": C, "P0": P0, "N": N})
    check("for a thing from one place, the line under the box gives the days it is first picked at, against its crop's", pl["said"] is not None and pl["said"].startswith(pl["want"]), pl)
    js("A.undo(); return 1;"); wait(400)
    # a planting shortened afterwards: the clamp is said, on the card (the bed named, the days that apply) and in its Schedule; Undo puts both back
    sh0 = js("return snap();")
    def clamp_case(dtm):
        """The planting set afterwards to `dtm` days to harvest: what the card's line and its Schedule say, and what they should."""
        js("A.updatePlanting(arg.P0, { dtm: arg.d, timingMode: 'manual' }, 'days to harvest, for the check'); return 1;", {"P0": P0, "d": dtm}); wait(500)
        js("A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg); return 1;", C); wait(500)
        got = js("""const eng = S.engine, p = eng.planting(arg.P0), r = eng.calc(p), x = eng.soldOf(p, r).find(q => q.thing === arg.T), td = document.querySelector(`#ycGrid tr[data-row="first"] td.yc-thing[data-thing="${arg.T}"]`), bed = A.bedLabel(eng.bedOf(p.bedId)), a = x.ahead || 0;
          return { ahead: a, asked: x.asked, before: S.plan.assumptions.sell[arg.C].things[arg.T].before, said: td ? txt(hook('thing-first-said', td)) : '', field: UI.day(r.field),
            want: a ? `in ${bed} it goes into its bed ${UI.day(r.field)}, so it is picked ${a} day${a === 1 ? '' : 's'} early there, from ${UI.day(x.first)}` : `in ${bed} none can apply: it goes into its bed ${UI.day(r.field)} and is first picked with ${eng.crop(arg.C).name} on ${UI.day(x.first)}`,
            row: a ? `(${a} of ${x.asked} days early: in its bed ${UI.day(r.field)})` : `(${x.asked} days early asked; none can apply: in its bed ${UI.day(r.field)}, first picked with ${eng.crop(arg.C).name})` };""", {"P0": P0, "T": T, "C": C})
        js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", P0); wait(500)
        got["rows"] = js("return hooks('early-pick').map(li => `${txt(li.querySelector('span'))} ${txt(li.querySelector('b'))}`);")
        return got
    sh = clamp_case(2)
    check("a planting shortened afterwards to two days in its bed: the stored days before stay; the card names its bed, the day it goes in and the days that apply, and its Schedule says the same with the date", sh["ahead"] == 1 and sh["before"] == N and sh["want"] in sh["said"] and len(sh["rows"]) == 1 and sh["rows"][0].endswith(sh["row"]) and sh["field"] in sh["rows"][0], sh)
    js("A.undo(); return 1;"); wait(400)
    z = clamp_case(1)
    check("shortened to one day in its bed, none of the days asked can apply: the card and the Schedule still say so, with the day it goes in, and the Schedule keeps its row", z["ahead"] == 0 and z["asked"] == N and z["before"] == N and z["want"] in z["said"] and len(z["rows"]) == 1 and z["rows"][0].endswith(z["row"]) and z["field"] in z["rows"][0], z)
    js("A.undo(); return 1;"); wait(400)
    js("A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg); return 1;", C); wait(500)
    back = js("""const td = document.querySelector(`#ycGrid tr[data-row="first"] td.yc-thing[data-thing="${arg}"]`); return { said: td ? txt(hook('thing-first-said', td)) : '', plan: snap().plan };""", T)
    js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", P0); wait(500)
    shb = js("return hooks('early-pick').map(li => txt(li.querySelector('b')));")
    check("and Undo puts the planting, the card and the Schedule back", back["plan"] == sh0["plan"] and ";" not in back["said"] and len(shb) == 1 and "(" not in shb[0], [back["said"], shb])
    # the planting's panel and its row in the bed's season
    js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", P0); wait(600)
    sched = js("""const eng = S.engine, p = eng.planting(arg.P0), r = eng.calc(p), part = eng.soldOf(p, r).find(x => x.thing === arg.T), items = [...document.querySelectorAll('#jobList > li')];
      const line = li => `${txt(li.querySelector('span'))} ${txt(li.querySelector('b'))}`, early = hooks('early-pick'), own = hook('schedule-first');
      return { lines: early.map(line), want: `Early ones from ${UI.day(part.first)}`, own: own ? line(own) : null, wantOwn: `Days to harvest ${UI.day(r.first)}`, order: early.length && own ? items.indexOf(early[0]) < items.indexOf(own) : false };""", {"P0": P0, "T": T})
    check("its panel's Schedule says when the thing is first picked, before the planting's own days to harvest, which no longer reads as its first harvest", sched["lines"] == [sched["want"]] and sched["own"] == sched["wantOwn"] and sched["order"] is True, sched)
    shot("panel-schedule")
    row = js("""const eng = S.engine, p = eng.planting(arg.P0), r = eng.calc(p), part = eng.soldOf(p, r).find(x => x.thing === arg.T); A.select({ type: 'bed', id: p.bedId });
      return { day: UI.day(part.first) };""", {"P0": P0, "T": T}); wait(600)
    detail = js("const b = document.querySelector(`[data-hook=\"card-planting\"][data-planting=\"${arg}\"]`); return b ? txt(b.querySelector('.row-detail')) : null;", P0)
    check("its row in the bed's season reads its picking from that day", detail is not None and f"pick {row['day']}" in detail, [detail, row])
    got_go = popup_tags(C, T, P0, True, go=True)
    tags, went = got_go if isinstance(got_go, tuple) else (got_go, {})
    check("the Forecast's popup, on a week before its days to harvest, lists it with a tag for the days it is picked early", tags is not None and ["early", f"{N} d early"] in tags, tags)
    first_day = js("const eng = S.engine, p = eng.planting(arg.P0), r = eng.calc(p); return E.d2s(eng.soldOf(p, r).find(x => x.thing === arg.T).first);", {"P0": P0, "T": T})
    after_last = js("""const eng = S.engine, p = eng.planting(arg.P0), r = eng.calc(p), x = eng.soldOf(p, r).find(q => q.thing === arg.T), d = E.addDays(x.last, 1); A.setDate(d);
      return { last: E.d2s(x.last), day: E.d2s(S.date), inBed: r.last >= d };""", {"P0": P0, "T": T}); wait(500)
    after_last["picking"] = js("const f = document.querySelector(`#mapBeds .bed-fill[data-planting=\"${arg}\"]`); return f ? f.classList.contains('pick') : null;", P0)
    check("the day after the only thing it is grown for is last picked, the map no longer shows its bed as picking, though the crop's own days run on", after_last["inBed"] is True and after_last["picking"] is False, after_last)
    check("“Show on the map” from it goes to the day the thing is first picked, not to its crop's days to harvest, and the map shows its bed as being picked that day", went.get("date") == first_day and went.get("view") == "map" and went.get("sel") == P0 and went.get("picking") is True, [went, first_day])
    # two early products entered out of date order: the later one first, the earlier one second. A planting grown for both by the
    # crop's shares lists them in date order in its Schedule, before its own days to harvest; "Show on the map" goes to each one's own day
    T2, P1 = "t-earlier-check", sub["p1"]
    js("""const before = S.plan.assumptions, after = JSON.parse(JSON.stringify(before)), things = after.sell[arg.C].things;
      things[arg.T2] = { ...things[arg.T], id: arg.T2, n: 2, name: 'Earlier ones', share: 20, before: arg.N + 1 };
      A.commit('a second thing, picked earlier, for the check', [{ kind: 'assume', before, after }], { unchecked: true }); return 1;""", {"C": C, "T": T, "T2": T2, "N": N}); wait(400)
    js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", P1); wait(600)
    two = js("""const eng = S.engine, p = eng.planting(arg.P1), r = eng.calc(p), parts = eng.soldOf(p, r), items = [...document.querySelectorAll('#jobList > li')], own = hook('schedule-first');
      const day = id => E.d2s(parts.find(x => x.thing === id).first), at = li => items.indexOf(li);
      return { got: hooks('early-pick').map(li => li.dataset.thing), firsts: { [arg.T]: day(arg.T), [arg.T2]: day(arg.T2) }, ownAfter: hooks('early-pick').every(li => at(li) < at(own)) };""", {"P1": P1, "T": T, "T2": T2})
    check("two early products entered out of date order: the planting grown for both lists them in date order, the earliest first, both before its own days to harvest", two["got"] == [T2, T] and two["firsts"][T2] < two["firsts"][T] and two["ownAfter"] is True, two)
    went2 = []
    for thing in (T2, T):
        g = popup_tags(C, thing, P1, True, go=True)
        went2.append(g[1].get("date") if isinstance(g, tuple) else None)
    check("“Show on the map” from each goes to its own first day", went2 == [two["firsts"][T2], two["firsts"][T]], [went2, two["firsts"]])
    js("A.undo(); return 1;"); wait(300)
    js("A.undo(); return 1;"); wait(500)
    u1 = js("return { snap: snap(), dates: dates(S.engine) };")
    check("Undo takes the days before back: the plan is as it was", u1["snap"]["plan"] == s1["plan"] and u1["dates"] == d1)

    # ── a stand by its age ──
    st = js("""const eng = S.engine, list = S.plan.plantings.filter(p => { const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null; return !!y && !y.own && y.set && y.units > 0 && eng.isPerennial(r.c) && !r.rack && /raspberr|blackberr/i.test(r.c.name) && eng.isSoilBed(r.b); });
      const p = list[0]; if (!p) return null; const r = eng.calc(p), c = eng.crop(p.cropId);
      return { id: p.id, crop: p.cropId, name: c.name, season: r.first.getFullYear(), stands: S.plan.plantings.filter(q => q.cropId === p.cropId && eng.bedOf(q.bedId)).length, bed: p.bedId, black: /blackberr/i.test(c.name) };""")
    check("a subject: a cane stand in a bed that follows the list", st is not None, st)
    if not st: finish()
    js("A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg); return 1;", st["crop"]); wait(700)
    yrow = lambda: js("""const tr = document.querySelector('#ycGrid tr[data-row="young"]'); if (!tr) return null; const box = i => { const el = tr.querySelector(`[data-yk="young|${i}"]`); return el ? { value: el.value, placeholder: el.placeholder, mine: !!el.closest('.yc-box.mine'), amber: !!el.closest('.yc-box.amber'), tip: el.title } : null; };
      return { name: txt(tr.querySelector('th b')), hint: txt(tr.querySelector('th small')), b0: box(0), b1: box(1), said: txt(hook('young-said', tr)), order: [...document.querySelectorAll('#ycGrid tbody tr')].map(t => t.dataset.row) };""")
    y0 = yrow()
    check("a perennial crop's card has a row for a young stand, after its yield, saying whose year it waits on and that an empty year is a mature stand", y0 and y0["name"] == "A young stand gives" and y0["order"].index("young") == y0["order"].index("yield") + 1 and "whose year is typed on its planting" in y0["hint"] and "empty year is a mature stand" in y0["hint"], y0)
    check("its two boxes hold the published figures in grey (none the year it is planted, 80% the year after), neither his nor amber", y0 and y0["b0"] and y0["b0"]["placeholder"] == "0" and y0["b1"]["placeholder"] == "80" and y0["b0"]["value"] == "" and not y0["b0"]["mine"] and not y0["b0"]["amber"], y0)
    who = "NC State" if st["black"] else "University of Idaho"
    check("each says whose figure it is, the place and the kind of grower, and that it counts only once a stand's year is typed; the line under them says his replace them and how many stands have a year", y0 and who in y0["b1"]["tip"] and "commercial" in y0["b1"]["tip"] and "Counted only for a stand whose year is typed" in y0["b1"]["tip"] and "Yours replace them" in y0["said"] and f"0 of {st['stands']} stand" in y0["said"], y0)
    s3 = js("return snap();"); w3 = js("return worthOf(S.engine);")
    js("return typeIn(document.querySelector('[data-yk=\"young|0\"]'), 50);"); wait(600); close_dialogs()
    yt = js("return { young: (S.plan.assumptions.sell[arg] || {}).young, undo: S.undo.length, worth: worthOf(S.engine), toast: toast() };", st["crop"]); y1 = yrow()
    check("his figure replaces the published one, one step; with no stand's year typed nothing is worth more or less", yt["young"] == [50, None] and yt["undo"] == s3["undo"] + 1 and abs(yt["worth"] - w3) < 1e-9 and "goes from" not in yt["toast"] and "a young stand gives 50%" in yt["toast"] and y1 and y1["b0"]["mine"] and y1["b0"]["value"] == "50", [yt, y1 and y1["b0"]])
    shot("card-young")
    js("A.undo(); return 1;"); wait(500)
    check("and Undo takes it back", js("return snap().plan;") == s3["plan"])
    # its panel
    js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", st["id"]); wait(600)
    f0 = js("const box = $('fStand'); return box ? { value: box.value, said: txt(hook('stand-said')), label: txt(hook('stand-label')), help: !!hook('stand-help') } : null;")
    check("the stand's panel has “Stand planted in”, empty, said to be his to type, with its “?”", f0 and f0["value"] == "" and f0["label"] == "Stand planted in" and f0["said"].startswith("Yours to type") and f0["help"], f0)
    (page.locator('[data-hook="stand-help"]').first.click() if page.locator('[data-hook="stand-help"]').count() else None); wait(300)
    hc = js("const c = hook('stand-help-card'); return c ? { term: txt(c.querySelector('dt')), text: txt(c) } : null;")
    check("its “?” gives the term in bold, then what it means: a young stand gives less, how much is on its crop's card, empty is a mature stand", hc and hc["term"] == "Stand planted in" and "Assumptions, Yield and price" in hc["text"] and "mature stand" in hc["text"], hc)
    (page.locator('[data-hook="stand-help"]').first.click() if page.locator('[data-hook="stand-help"]').count() else None); wait(200)
    s4 = js("return snap();"); d4 = js("return dates(S.engine);"); prev = st["season"] - 1
    js("return typeIn($('fStand'), %d);" % prev); wait(700)
    sp = js("""const eng = S.engine, p = eng.planting(arg.id), want = copy(); want.plantings = want.plantings.map(q => q.id === arg.id ? q : q); const was = engineOf(JSON.parse(arg.plan));
      return { plantedIn: p.plantedIn, undo: S.undo.length, dates: dates(eng), worth: worthOf(eng), was: worthOf(was), units: eng.yieldOf(p).units, base: was.yieldOf(was.planting(arg.id)).units, toast: toast(), line: txt($('fYieldLine')), said: txt(hook('stand-said')) };""", {"id": st["id"], "plan": s4["plan"]})
    check("typed a year before the season, one step: the planting holds it, and nothing else changed", sp["plantedIn"] == prev and sp["undo"] == s4["undo"] + 1, sp)
    check("no planting's dates or ground move", sp["dates"] == d4)
    check("it gives 80% of the list's yield in its second season, and the season's worth falls by what it does not give", abs(sp["units"] - sp["base"] * 0.8) < 1e-9 and sp["worth"] < sp["was"], sp)
    check("the message says its season and share, and the season's worth before and after, with Undo", "second season, 80%" in sp["toast"] and f"from {'$' + format(round(sp['was']), ',')} to {'$' + format(round(sp['worth']), ',')}" in sp["toast"] and page.locator("#toast button").count() > 0, sp["toast"])
    check("the Expected line and the line under the box say so", "80% of it, in the stand’s second season" in sp["line"] and sp["said"].startswith("Its second season: 80%"), [sp["line"], sp["said"]])
    shot("panel-stand")
    s5 = js("return snap();")
    js("return typeIn($('fStand'), %d);" % (st["season"] + 1)); wait(500)
    fut = js("return { toast: toast(), snap: snap() };")
    check("a year after the season it is picked in is refused in a sentence; nothing changes", f"planted in {st['season']} or before" in fut["toast"] and fut["snap"]["plan"] == s5["plan"], fut["toast"])
    tags2 = popup_tags(st["crop"], "", st["id"], False)
    check("the Forecast's popup tags it with its season and share", tags2 is not None and ["stand", "2nd season · 80%"] in tags2, tags2)
    # its row in the bed's season holds the same box
    js("A.setView('map'); A.select({ type: 'bed', id: arg }); return 1;", st["bed"]); wait(600)
    trig = page.locator(f'[data-hook="card-planting"][data-planting="{st["id"]}"]')
    if trig.count(): trig.first.click(); wait(500)
    rb = js("const el = document.querySelector('input[name=\"bed-stand\"]'); return el ? { value: el.value, hook: el.dataset.hook } : null;")
    check("its row in the bed's season, opened, holds the same box with its year", rb and rb["value"] == str(prev) and rb["hook"] == "stand-year", rb)
    js("return typeIn(document.querySelector('input[name=\"bed-stand\"]'), '');"); wait(600)
    em = js("return { has: 'plantedIn' in S.engine.planting(arg), undo: S.undo.length, toast: toast() };", st["id"])
    check("emptied there, one step: a mature stand again, and the message says so", em["has"] is False and em["undo"] == s5["undo"] + 1 and "a mature stand" in em["toast"], em)
    shot("bed-season-stand")
    # a split cane stand first picked Jan 10, something else it sells 20 days early (Dec 21 the year before), shares 10 and 80: each path
    # (year then days before, days before then year, and the planting's date moved last) ends in the same figures and words; a part
    # picked before the stand is planted counts nothing and is said with its date on the panel, the Expected line, the Schedule and the card
    sp0 = js("return snap();"); Y = st["season"]
    field = js("""const eng = S.engine, p = eng.planting(arg), r = eng.calc(p); return E.d2s(E.addDays(new Date(A.planYear(), 0, 10), -Math.round(E.dayDiff(r.first, r.field))));""", st["id"])
    js("""const before = S.plan.assumptions || null, after = before ? JSON.parse(JSON.stringify(before)) : { v: 1, crops: {}, varieties: {} };
      after.sell = after.sell || {}; after.sell[arg] = { ...(after.sell[arg] || {}), young: [10, 80], things: { 't-cane': { id: 't-cane', n: 1, name: 'Seconds', from: 'bed', unit: 'lb', price: 2, pattern: 'spread', share: 50, yield: 0.4 } } };
      A.commit('a thing out of each bed and his shares, for the check', [{ kind: 'assume', before, after }], { unchecked: true }); return 1;""", st["crop"]); wait(400)
    base = js("return S.undo.length;")
    def year_step(y):
        js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", st["id"]); wait(400)
        js("return typeIn($('fStand'), %d);" % y); wait(500)
    def lead_step(): page.evaluate("async (c) => { await LRFApp.setThing(c, 't-cane', { before: 20 }, 'twenty days before, for the check'); }", st["crop"]); wait(400)
    def date_step(): js("A.updatePlanting(arg.id, { date: arg.d }, 'moved, for the check'); return 1;", {"id": st["id"], "d": field}); wait(400)
    def read():
        js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", st["id"]); wait(500)
        out = js("""const eng = S.engine, p = eng.planting(arg), box = $('fStand');
          return { plan: JSON.stringify({ plantedIn: p.plantedIn, date: p.date, before: S.plan.assumptions.sell[p.cropId].things['t-cane'].before }), rows: rowsOf(S.engine), said: txt(hook('stand-said')), line: txt($('fYieldLine')), early: hooks('early-pick').map(li => txt(li)), max: box ? +box.max : null, value: box ? +box.value : null };""", st["id"])
        js("A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg); return 1;", st["crop"]); wait(500)
        out["card"] = js("return txt(hook('young-said'));")
        return out
    def back_to(n):
        while js("return S.undo.length;") > n: js("A.undo(); return 1;"); wait(200)
    date_step(); year_step(Y); lead_step(); a = read(); back_to(base)
    date_step(); lead_step(); year_step(Y); b = read(); back_to(base)
    year_step(Y); lead_step(); date_step(); c = read()
    want = f"Seconds first picked Dec 21, {Y - 1}, before the stand is planted ({Y}): none counted that year."
    check("year then days before, days before then year, and the date moved last: the same figures and the same words", a["plan"] == b["plan"] == c["plan"] and a["rows"] == b["rows"] == c["rows"] and a["said"] == b["said"] == c["said"] and a["line"] == b["line"] == c["line"] and a["card"] == b["card"] == c["card"], [a["said"], b["said"], c["said"]])
    check("planted that season, the part picked in December before it is planted is said with its date on the panel, the Expected line, the Schedule and the crop's card, and counts nothing", want in a["said"] and "(none: before the stand is planted)" in a["line"] and any(f"Dec 21, {Y - 1}" in x and f"before the stand is planted ({Y})" in x for x in a["early"]) and f"first picked Dec 21, {Y - 1}, before the stand is planted ({Y})" in a["card"], a)
    check("the year saved stays, and the box's latest year is not below it", a["value"] == Y and a["max"] >= Y, [a["value"], a["max"]])
    js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", st["id"]); wait(400)
    js("return typeIn($('fStand'), %d);" % (Y - 1)); wait(500); d = read()
    check("planted the year before: each part says its own share, the December part its first season (10%), its own line its second (80%)", f"Seconds, first picked Dec 21, {Y - 1}: its first season, 10%." in d["said"] and "(10%, its first season)" in d["line"] and "(80%, its second season)" in d["line"], [d["said"], d["line"]])
    back_to(base); js("A.undo(); return 1;"); wait(400)
    check("and Undo takes each step back to the plan before them", js("return snap().plan;") == sp0["plan"])
    while js("return S.undo.length;") > 0: js("A.undo(); return 1;"); wait(150)
    check("every step undone, the plan is the one the page was given", js("return snap().plan;") == start["plan"])
    check("no error on the page", not errors, errors[:4])
    finish()
