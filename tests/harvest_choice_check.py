"""The card's harvest choice, in a real browser: on a crop's card under Assumptions, Yield and price, and on "All on one page", the
harvest window is one joined choice, to the season's end or for a set number of days. Every crop's choice is held against what the
plan stores (the list's harvest days, the crop's own record); each place's last picking against the engine; a change against the
same change made here by hand to a copy of the plan: what the sheet says it moves and what the season is worth before and after,
the fields it writes and no others, the forecast it leaves, and Undo. The yield's row is read by its hook: "Marketable yield".
Every subject is found on the plan the page was given: nothing here names a crop, a bed, a garden or a number of any plan.
usage: python3 -I harvest_choice_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, $ = id => document.getElementById(id);"
       "const hook = (name, el) => (el || document).querySelector(`[data-hook=\"${name}\"]`), hooks = (name, el) => [...(el || document).querySelectorAll(`[data-hook=\"${name}\"]`)];"
       "const worthOf = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);"
       # what the plan itself stores for a crop's harvest window, read here and not from the planner's own reading of it
       "const sellOf = id => ((S.plan.assumptions || {}).sell || {})[id] || {}, listDays = id => sellOf(id).days != null ? +sellOf(id).days : null;"
       "const seasonOf = id => listDays(id) == null && S.engine.crop(id).harvestMode === 'season';"
       "const offerOf = id => { const c = S.engine.crop(id); return seasonOf(id) ? Math.max(1, Math.round(+c.hw)) : listDays(id) != null ? listDays(id) : Math.max(1, Math.round(+c.hw)); };"
       # a planting that carries a window of its own (it, or its variety), or a last day of its own, does not follow the crop's line
       "const ownW = o => !!o && (o.harvestMode === 'season' || o.harvestMode === 'window' || (o.hw != null && o.hw !== '' && +o.hw >= 0));"
       "const placeOf = (e, p) => { const b = e.bedOf(p.bedId); return !b || e.isRack(b) ? null : e.envOf(b); };"
       "const followsP = (e, p) => { const v = e.variety(p.varietyId); return !ownW(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && ownW(v)); };"
       "const ends = (e, id) => { const out = {}; for (const p of e.plan.plantings) { if (p.cropId !== id || !followsP(e, p)) continue; const env = placeOf(e, p), r = env ? e.calc(p) : null; if (!r || !(r.harvestDays > 0)) continue; const x = out[env] || (out[env] = { from: E.d2s(r.last), to: E.d2s(r.last), n: 0 }); const d = E.d2s(r.last); if (d < x.from) x.from = d; if (d > x.to) x.to = d; x.n++; } return out; };"
       "const ownN = (e, id) => e.plan.plantings.filter(p => p.cropId === id && placeOf(e, p) && e.calc(p) && !followsP(e, p)).length;"
       # the plan with a change made here by hand, and its engine
       "const copy = () => JSON.parse(JSON.stringify(S.plan)), engineOf = plan => E.create(plan, LRFLibrary);"
       "const withDays = (id, n) => { const p = copy(); p.assumptions = p.assumptions || { v: 1, crops: {}, varieties: {} }; p.assumptions.sell = p.assumptions.sell || {}; p.assumptions.sell[id] = { ...(p.assumptions.sell[id] || {}), days: n }; return p; };"
       "const withSeason = id => { const p = copy(); const sell = ((p.assumptions || {}).sell || {})[id]; if (sell) delete sell.days; p.crops = p.crops || []; const i = p.crops.findIndex(c => c.id === id); if (i >= 0) p.crops[i] = { ...p.crops[i], harvestMode: 'season' }; else p.crops.push({ id, harvestMode: 'season' }); return p; };"
       # each place's last picking that moves between two engines, for the plantings that follow the line
       "const moves = (a, b, id) => { const out = {}; for (const p of a.plan.plantings) { if (p.cropId !== id || !followsP(a, p)) continue; const env = placeOf(a, p), r = env ? a.calc(p) : null, q = b.planting(p.id), s = r && q ? b.calc(q) : null; if (!r || !s || +r.last === +s.last || (!(r.harvestDays > 0) && !(s.harvestDays > 0))) continue; const x = out[env] || (out[env] = { wasFrom: '', wasTo: '', wasNone: 0, nowFrom: '', nowTo: '', nowNone: 0, n: 0 }); x.n++; for (const [k, q] of [['was', r], ['now', s]]) { if (!(q.harvestDays > 0)) { x[k + 'None']++; continue; } const d = E.d2s(q.last); if (!x[k + 'From'] || d < x[k + 'From']) x[k + 'From'] = d; if (!x[k + 'To'] || d > x[k + 'To']) x[k + 'To'] = d; } } return out; };"
       "const twice = (a, b) => { const pairs = e => { const m = new Map(); for (const p of e.plan.plantings) { const r = e.calc(p); if (r) for (const o of e.conflicts(p, r)) if (!o.rest) m.set([p.id, o.p.id].sort().join('|'), p.bedId); } return m; }; const was = pairs(a); return [...new Set([...pairs(b)].filter(([k]) => !was.has(k)).map(([, bed]) => A.bedLabel(b.bedOf(bed), b)))].sort(); };"
       # the forecast's rows, each with its total, worth and day-by-day amounts: what "the forecast" is when two are compared
       "const rowsOf = e => Object.fromEntries(F.build(e).rows.map(r => [r.key, { crop: r.cropId, total: r.total, worth: r.worth, days: [...r.days].map(x => Math.round(x * 1e6) / 1e6).join(',') }]));"
       "const sameRows = (a, b, only) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]), bad = []; for (const key of k) { const x = a[key], y = b[key], crop = (x || y).crop; if (only && !only(crop)) continue; if (!x || !y || Math.abs(x.total - y.total) > 1e-6 || Math.abs(x.worth - y.worth) > 1e-6 || x.days !== y.days) bad.push(key); } return bad; };"
       "const snap = () => ({ key: A.contentKey(), undo: S.undo.length, plan: JSON.stringify({ ...S.plan, lrfNext: null }) });"
       "const seen = el => !!el && el.offsetParent !== null;"
       # the choice as it stands in a host (the card, or a row of the list)
       "const choiceIn = host => { const g = hook('harvest-choice', host); if (!g) return null; const box = g.querySelector('input'), end = hook('harvest-season', g), days = hook('harvest-days', g);"
       " const ink = el => el ? getComputedStyle(el).backgroundColor : '';"
       " return { on: g.dataset.on, season: end ? end.getAttribute('aria-pressed') : null, days: days ? days.getAttribute('aria-pressed') : null, value: box ? box.value : null, placeholder: box ? box.placeholder : null, endInk: ink(end), daysInk: ink(days && days.parentElement), seen: seen(g) }; };"
       "const cardChoice = () => choiceIn($('ycCard'));"
       # a place's last picking on the card (E2c): the date in its box, his or the season's end there, and whose day the card says it is
       "const untilCells = () => Object.fromEntries(hooks('harvest-until', $('ycCard')).map(el => { const td = el.closest('td'); return [el.dataset.place, { value: el.value, mine: el.dataset.mine, whose: (hook('harvest-until-whose', td) || {}).textContent || '', frost: !!hook('harvest-until-frost', td), close: !!hook('harvest-until-close', td) }]; }));"
       "const BY = { frost: 'your first frost', cover: 'the first frost, under cover', close: 'the garden closes', record: 'the crop’s record', year: 'the year’s end' };"
       "const untilWant = (e, id, envs) => { const year = +e.plan.settings.year, mine = sellOf(id).until || {}; return Object.fromEntries(envs.map(env => { const se = e.seasonEndOf(id, env, year), own = mine[env] ? `${year}-${mine[env]}` : null; return [env, { value: own || (se ? E.d2s(se.date) : ''), mine: mine[env] || '', whose: own ? 'yours' : se ? BY[se.by] : '', frost: !!(own && se && se.frost && own > E.d2s(se.frost) && !(se.close && se.close < se.frost)), close: !!(own && se && se.close && own > E.d2s(se.close) && !(se.frost && own > E.d2s(se.frost) && !(se.close < se.frost))) }]; })); };"
       "const withUntil = (id, env, md) => { const p = copy(); p.assumptions = p.assumptions || { v: 1, crops: {}, varieties: {} }; p.assumptions.sell = p.assumptions.sell || {}; const line = { ...(p.assumptions.sell[id] || {}) }, u = { ...(line.until || {}) }; if (md) u[env] = md; else delete u[env]; if (Object.keys(u).length) line.until = u; else delete line.until; if (Object.keys(line).length) p.assumptions.sell[id] = line; else delete p.assumptions.sell[id]; return p; };"
       "const pickDate = (env, value) => { const el = $('ycCard').querySelector(`[data-hook=\"harvest-until\"][data-place=\"${env}\"]`); if (!el) return false; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; };"
       "const cardEnds = () => Object.fromEntries(hooks('harvest-end', $('ycCard')).map(el => [el.dataset.place, { from: el.dataset.from, to: el.dataset.to, n: +el.dataset.n }]));"
       "const sheet = () => { const d = document.querySelector('dialog[open]'), m = d && hook('harvest-moves', d); if (!m) return d ? { other: true, title: (d.querySelector('h2') || {}).textContent } : null; const w = hook('harvest-worth', m), t = hook('harvest-twice', m), o = hook('harvest-own', m);"
       " return { title: (d.querySelector('h2') || {}).textContent || '', text: d.innerText, moves: Object.fromEntries(hooks('harvest-move', m).map(li => [li.dataset.place, { wasFrom: li.dataset.wasFrom, wasTo: li.dataset.wasTo, wasNone: +li.dataset.wasNone, nowFrom: li.dataset.nowFrom, nowTo: li.dataset.nowTo, nowNone: +li.dataset.nowNone, n: +li.dataset.n }])), was: w ? +w.dataset.was : null, now: w ? +w.dataset.now : null, beds: t ? (t.dataset.beds ? t.dataset.beds.split('|').sort() : []) : null, own: o ? +o.dataset.n : 0 }; };")
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
    page.evaluate("LRFApp.state.undo.length = 0")   # loading a backup is a step of its own: the checks below count from here
    class Missing(dict):
        """What a reading gives when the thing read is not on the page (a fault took it away): false, equal to nothing, and it can be
        asked for anything, so the named line that reads it fails and the check goes on to its end."""
        def __getitem__(self, k): return Missing()
        def get(self, k, d=None): return Missing() if d is None else d
        def __bool__(self): return False
        def __eq__(self, o): return False
        def __ne__(self, o): return True
        def __hash__(self): return 0
        def __iter__(self): return iter(())
        def __len__(self): return 0
        def __contains__(self, k): return False
        def __lt__(self, o): return False
        __gt__ = __le__ = __ge__ = __lt__
        def __sub__(self, o): return Missing()
        __rsub__ = __add__ = __radd__ = __sub__
        def __abs__(self): return float("inf")
        def __str__(self): return "(not there)"
    def soft(v):
        if v is None: return Missing()
        if isinstance(v, dict): return type("Soft", (dict,), {"__getitem__": lambda s, k: dict.get(s, k, Missing()), "get": lambda s, k, d=None: dict.get(s, k, Missing() if d is None else d)})({k: soft(x) for k, x in v.items()})
        if isinstance(v, list): return [soft(x) for x in v]
        return v
    def js(body):
        try: return soft(page.evaluate("(() => { " + PRE + " " + body + " })()"))
        except Exception as e: errors.append(str(e)[:200]); return Missing()
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0 and page.locator(sel).first.is_visible()
    def click(sel, ms=400):
        if not has(sel): wait(100); return False
        try: page.locator(sel).first.click(timeout=4000)
        except Exception: return False
        wait(ms); return True
    def typed(sel, text, key="Tab", ms=600):
        if not has(sel): wait(100); return False
        try: page.locator(sel).first.click(timeout=4000)
        except Exception: return False
        page.keyboard.press("Control+a"); page.keyboard.type(text)
        if key: page.keyboard.press(key)
        wait(ms); return True
    def answer(yes, ms=900): return click("dialog[open] .btn.primary" if yes else "dialog[open] .dialog-actions .btn:not(.primary)", ms)
    def undo_to(n):
        for _ in range(20):
            u = js("return S.undo.length;")
            if not isinstance(u, int) or u <= n: break
            js("A.undo(); return 1;"); wait(300)
    def open_crop(cid, ms=300): return click(f'#ycList .yc-item[data-crop="{cid}"]', ms)
    def last_step(): return js("const u = S.undo[S.undo.length - 1]; return u ? { label: u.label, n: S.undo.length, kinds: u.ops.map(o => o.kind || 'planting') } : { label: '', n: 0, kinds: [] };")
    shot = lambda name: page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))

    start = js("return { n: S.plan.plantings.length, undo: S.undo.length, sample: A.isSample() };")
    check("a plan is open and there is nothing to undo", start["n"] > 300 and start["undo"] == 0 and start["sample"] is False, start)
    snap0 = js("return snap();")
    page.evaluate("LRFApp.setView('assume')"); wait(500)
    click('[data-as-mode="harvest"]', 600); click('[data-ah-way="card"]', 600)
    ids = js("return [...document.querySelectorAll('#ycList .yc-item')].map(b => b.dataset.crop);")
    check("the checklist of Yield and price lists the crops to walk", isinstance(ids, list) and len(ids) > 20, ids)

    # ── every card: the choice shows the crop's line truly, and Last picking the engine's dates ──
    wrong_choice, wrong_ends, walked, wrong_until, said_twice = [], [], 0, [], []
    for cid in ids if isinstance(ids, list) else []:
        open_crop(cid, 60)
        k = js("const id = %s, c = S.engine.crop(id), micro = !!c.micro, ch = cardChoice(), once = S.engine.harvestFor(id).pattern.value === 'once', envs = [...$('ycCard').querySelectorAll('thead th[data-place]')].map(th => th.dataset.place);"
               "const lastRow = $('ycCard').querySelector('tr[data-row=last]'), said = lastRow ? lastRow.innerText : '';"
               "return { id, micro, once, ch, want: micro ? null : { on: seasonOf(id) ? 'season' : 'days', value: listDays(id) == null ? '' : String(listDays(id)), placeholder: String(offerOf(id)) }, ends: cardEnds(), engine: micro || once ? {} : ends(S.engine, id),"
               " until: untilCells(), untilWant: micro || once || !seasonOf(id) ? {} : untilWant(S.engine, id, envs), twice: !micro && !seasonOf(id) && /\\b\\d+ days after\\b/.test(said) };" % json.dumps(cid))
        walked += 1
        if k["until"] != k["untilWant"]: wrong_until.append({"crop": cid, "card": k["until"], "plan": k["untilWant"]})
        if k["twice"]: said_twice.append(cid)
        if k["micro"]:
            if k["ch"]: wrong_choice.append(cid + " (a live tray has a choice)")
            continue
        ch, w = k["ch"], k["want"]
        if not ch or ch["on"] != w["on"] or ch["season"] != ("true" if w["on"] == "season" else "false") or ch["days"] != ("true" if w["on"] == "days" else "false") or ch["value"] != w["value"] or ch["placeholder"] != w["placeholder"]:
            wrong_choice.append({"crop": cid, "card": ch, "plan": w})
        if not k["once"] and k["ends"] != k["engine"]: wrong_ends.append({"crop": cid, "card": k["ends"], "engine": k["engine"]})
    check("on every crop's card the harvest choice shows the side the plan stores: to the season's end where the crop's record says so and the list holds no days, else for its days, the list's number in the box as his and the crop's in grey", walked == len(ids) and not wrong_choice, wrong_choice[:3])
    check("Last picking shows for each place the dates of the plantings there that follow the crop's line, as the engine works them out, and no date where none follows", walked == len(ids) and not wrong_ends and sum(1 for c in ids) > 0, wrong_ends[:3])
    check("picked to the season's end, Last picking holds a date for each place: his where he set one, else the season's end there as the engine has it, saying whose day it is", walked == len(ids) and not wrong_until, wrong_until[:2])
    check("picked for a set number of days, the card says the number once, in the Picked row: Last picking gives dates and never the days again", walked == len(ids) and not said_twice, said_twice[:4])
    # ── the yield's row, by its hook ──
    sub = js("""const m = S.engine.crops().filter(c => !c.micro && S.plan.plantings.some(p => p.cropId === c.id)), hc = c => S.engine.harvestFor(c.id), plantings = id => S.plan.plantings.filter(p => p.cropId === id && placeOf(S.engine, p) && S.engine.calc(p));
      const followers = id => plantings(id).filter(p => followsP(S.engine, p)).length, open = c => hc(c).pattern.value !== 'once' && followers(c.id) > 0, rec = id => (S.plan.crops || []).some(x => x.id === id);
      const pick = f => (m.find(f) || {}).id || null;
      const inOpen = id => plantings(id).filter(p => followsP(S.engine, p) && S.engine.openGround(S.engine.gardenOf(S.engine.bedOf(p.bedId))) && S.engine.calc(p).harvestDays > 20).length;
      return { season: pick(c => seasonOf(c.id) && open(c)), frosty: pick(c => seasonOf(c.id) && open(c) && c.frostTender && inOpen(c.id) > 0 && !(sellOf(c.id).until)), days: pick(c => !seasonOf(c.id) && listDays(c.id) == null && open(c) && rec(c.id) && !(S.plan.crops.find(x => x.id === c.id).harvestMode)) || pick(c => !seasonOf(c.id) && listDays(c.id) == null && open(c)),
        plant: pick(c => hc(c).basis === 'plant' && !hc(c).weekly && hc(c).pattern.value === 'spread'), ft: pick(c => hc(c).basis === 'ft' && !hc(c).weekly), names: Object.fromEntries(m.map(c => [c.id, c.name])) };""")
    check("the plan has a crop of each kind to change: picked to the season's end (and one of them frost-tender, in open ground), picked for a number of days, counted by the plant and by the bed-foot, each with plantings that follow its line", all(isinstance(sub[k], str) for k in ("season", "frosty", "days", "plant", "ft")), {k: v for k, v in sub.items() if k != "names"})
    names = sub["names"]
    open_crop(sub["plant"]); lab = js("const tr = $('ycCard').querySelector('tr[data-row=yield]'); return { name: (hook('card-row-name', tr) || {}).textContent, hint: (hook('card-row-hint', tr) || {}).textContent };")
    open_crop(sub["ft"]); lab2 = js("const tr = $('ycCard').querySelector('tr[data-row=yield]'); return { name: (hook('card-row-name', tr) || {}).textContent, hint: (hook('card-row-hint', tr) || {}).textContent };")
    check("the yield's row reads “Marketable yield per plant”, or “per bed-foot” where the crop is counted so, and its hint says it is the packed weight", lab["name"] == "Marketable yield per plant" and "packed weight" in str(lab["hint"]) and lab2["name"] == "Marketable yield per bed-foot" and "packed weight" in str(lab2["hint"]), [lab, lab2])

    # ── the list: the same choice on every row ──
    click('[data-ah-way="list"]', 700)
    rows = js("""const out = {}; for (const tr of document.querySelectorAll('#ahBody tr.as-crop')) { const id = tr.dataset.crop, c = S.engine.crop(id); out[id] = { ch: choiceIn(tr), want: c.micro ? null : { on: seasonOf(id) ? 'season' : 'days', value: listDays(id) == null ? '' : String(listDays(id)), placeholder: String(offerOf(id)) } }; } return out;""")
    bad = [cid for cid, r in (rows.items() if isinstance(rows, dict) else []) if (r["want"] and (not r["ch"] or r["ch"]["on"] != r["want"]["on"] or r["ch"]["value"] != r["want"]["value"] or r["ch"]["placeholder"] != r["want"]["placeholder"] or r["ch"]["season"] != ("true" if r["want"]["on"] == "season" else "false"))) or (not r["want"] and r["ch"])]
    check("on “All on one page” every crop's row shows the same choice, the same number and the same grey", isinstance(rows, dict) and len(rows) == len(ids) and not bad, bad[:4])
    inks = js("const out = []; for (const tr of document.querySelectorAll('#ahBody tr.as-crop')) { const c = choiceIn(tr); if (c) out.push(c); } return out;")
    dark = [x for x in inks if (x["on"] == "season" and (x["endInk"] == x["daysInk"])) or (x["on"] == "days" and x["endInk"] == x["daysInk"])] if isinstance(inks, list) else ["none"]
    sides = set(x["on"] for x in inks) if isinstance(inks, list) else set()
    check("one switch: the chosen side stands in ink and the other does not, on both sides of the choice", isinstance(inks, list) and len(inks) > 10 and not dark and sides == {"season", "days"} and len(set(x["endInk"] for x in inks if x["on"] == "season")) == 1 and len(set(x["daysInk"] for x in inks if x["on"] == "days")) == 1 and next(x["endInk"] for x in inks if x["on"] == "season") == next(x["daysInk"] for x in inks if x["on"] == "days"), dark[:2])
    shot("list")
    click('[data-ah-way="card"]', 600)
    walked_snap = js("return snap();")
    check("opening the page and walking every card and the list changes nothing in the plan, and leaves nothing to undo", walked_snap["key"] == snap0["key"] and walked_snap["plan"] == snap0["plan"] and walked_snap["undo"] == 0, {"undo": walked_snap["undo"]})

    # ── a crop picked to the season's end, set for a number of days ──
    cid = sub["season"]; open_crop(cid)
    offer = js("return offerOf(%s);" % json.dumps(cid))
    want = js("const id = %s, n = offerOf(id), b = engineOf(withDays(id, n)); return { moves: moves(S.engine, b, id), was: worthOf(S.engine), now: worthOf(b), beds: twice(S.engine, b), own: ownN(S.engine, id), ends: ends(b, id) };" % json.dumps(cid))
    click('#ycCard [data-hook="harvest-days"]', 700)
    sh = js("return sheet();"); asked = js("return snap();")
    shot("sheet-days")
    check("a press on the other side asks first, and nothing changes while it asks", bool(sh) and isinstance(sh.get("moves"), dict) and asked["key"] == snap0["key"] and asked["undo"] == 0 and f"picked for {offer} days" in str(sh["title"]), sh)
    check("the sheet says, place by place, how the last picking of the plantings that follow the line moves, as the engine works it out on the plan with the list's days set, and how many keep their own", bool(sh) and sh["moves"] == want["moves"] and len(want["moves"]) > 0 and sh["own"] == want["own"], {"sheet": sh.get("moves"), "engine": want["moves"], "own": [sh.get("own"), want["own"]]})
    check("the season's worth before and after in the sheet is the forecast's, on the plan as it is and on the plan with the change", bool(sh) and abs(sh["was"] - want["was"]) < 0.005 and abs(sh["now"] - want["now"]) < 0.005, {"sheet": [sh.get("was"), sh.get("now")], "engine": [want["was"], want["now"]]})
    check("the sheet names the beds the change would book twice, and no other", bool(sh) and sh["beds"] == want["beds"], {"sheet": sh.get("beds"), "engine": want["beds"]})
    answer(False)
    after_cancel = js("return { snap: snap(), ch: cardChoice() };")
    check("Cancel changes nothing, and the choice stays where it was", after_cancel["snap"]["key"] == snap0["key"] and after_cancel["snap"]["undo"] == 0 and after_cancel["ch"]["on"] == "season", after_cancel["ch"])
    rows0 = js("return rowsOf(S.engine);")
    click('#ycCard [data-hook="harvest-days"]', 700); answer(True, 1200)
    st = last_step(); got = js("const id = %s, b = engineOf(withDays(id, %d)); return { assume: JSON.stringify(S.plan.assumptions || null), want: JSON.stringify(b.plan.assumptions || null), crops: JSON.stringify(S.plan.crops || null), toast: ($('toast') || {}).textContent || '', rows: rowsOf(S.engine), wantRows: rowsOf(b), ch: cardChoice(), ends: cardEnds(), worth: worthOf(S.engine) };" % (json.dumps(cid), offer if isinstance(offer, int) else 0))
    crops0 = js("return JSON.stringify(JSON.parse(%s).crops || null);" % json.dumps(snap0["plan"] if isinstance(snap0["plan"], str) else "{}"))
    check("agreed, it is one step of the list's own, in its words: the list's harvest days for the crop are that number, and nothing else in the plan is written", st["n"] == 1 and st["kinds"] == ["assume"] and st["label"] == f"{names.get(cid)}: picked for {offer} days" and got["assume"] == got["want"] and got["crops"] == crops0, {"step": st, "stored": got["assume"][:300] if isinstance(got["assume"], str) else None})
    bad_crop = js("return sameRows(%s, %s, c => c === %s);" % (json.dumps(got["rows"]), json.dumps(got["wantRows"]), json.dumps(cid)))
    bad_rest = js("return sameRows(%s, %s, c => c !== %s);" % (json.dumps(rows0), json.dumps(got["rows"]), json.dumps(cid)))
    check("the forecast then is the engine's on the plan with the change, day by day, and every other crop's is as it was", bad_crop == [] and bad_rest == [] and isinstance(got["rows"], dict) and len(got["rows"]) > 20, {"crop": bad_crop, "rest": bad_rest[:4] if isinstance(bad_rest, list) else bad_rest})
    check("the card then stands on the days side, the number his, and Last picking shows the new dates", got["ch"]["on"] == "days" and got["ch"]["days"] == "true" and got["ch"]["value"] == str(offer) and got["ends"] == want["ends"], {"choice": got["ch"], "ends": [got["ends"], want["ends"]]})
    check("the message says what it did and the season's worth, with Undo", f"picked for {offer} days" in got["toast"] and "season’s worth" in got["toast"] and "Undo" in got["toast"], got["toast"])
    # a year of harvest days runs past the year's end: what is picked after it is not this season's, so the worth moves
    long = js("const id = %s, b = engineOf(withDays(id, 365)); return { was: worthOf(S.engine), now: worthOf(b) };" % json.dumps(cid))
    typed('#ycCard [data-yk="days"]', "365", "Tab", 900)
    sh_long = js("return sheet();"); answer(False)
    check("a number typed in the box asks with the same sheet, and where the season's worth moves the sheet's after is the forecast's on the plan with that number", bool(sh_long) and abs(sh_long["was"] - long["was"]) < 0.005 and abs(sh_long["now"] - long["now"]) < 0.005 and abs(long["now"] - long["was"]) >= 0.5 and js("return S.undo.length;") == 1, {"sheet": [sh_long.get("was"), sh_long.get("now")] if sh_long else None, "engine": long})
    click('#ycCard [data-hook="harvest-season"]', 700)
    sh_back = js("return sheet();"); answer(True, 1200)
    st_back = last_step(); round_trip = js("return { snap: snap(), ch: cardChoice() };")
    check("pressed back to the season's end, the list's days for the crop are cleared again: a second step, and the plan as it was opened", bool(sh_back) and st_back["n"] == 2 and st_back["kinds"] == ["assume"] and round_trip["snap"]["plan"] == snap0["plan"] and round_trip["ch"]["on"] == "season", {"step": st_back, "choice": round_trip["ch"]})
    undo_to(1)
    undo_to(0); back = js("return { snap: snap(), ch: cardChoice() };")
    check("Undo puts the plan back as it was, and the choice back to the season's end", back["snap"]["key"] == snap0["key"] and back["snap"]["plan"] == snap0["plan"] and back["ch"]["on"] == "season", back["ch"])
    plan_card = got["assume"]

    # ── a last picking for a place (E2c): a date of his own, shown first, one step, Undo; past the frost in open ground, cut short ──
    fid = sub["frosty"]; open_crop(fid)
    fenv = js("const id = %s, hits = S.plan.plantings.filter(p => p.cropId === id && followsP(S.engine, p) && S.engine.openGround(S.engine.gardenOf(S.engine.bedOf(p.bedId))) && S.engine.calc(p) && S.engine.calc(p).harvestDays > 20); return hits.length ? placeOf(S.engine, hits[0]) : null;" % json.dumps(fid))
    fd = js("const env = %s, se = S.engine.seasonEndOf(%s, env, +S.plan.settings.year); return se && se.frost ? { frost: E.d2s(se.frost), before: E.d2s(E.addDays(se.frost, -12)), past: E.d2s(E.addDays(se.frost, 9)) } : null;" % (json.dumps(fenv), json.dumps(fid)))
    uwant = js("const id = %s, b = engineOf(withUntil(id, %s, %s)); return { moves: moves(S.engine, b, id), was: worthOf(S.engine), now: worthOf(b), beds: twice(S.engine, b), assume: JSON.stringify(b.plan.assumptions || null), rows: rowsOf(b), ends: ends(b, id) };" % (json.dumps(fid), json.dumps(fenv), json.dumps(fd["before"][5:] if fd else "")))
    rows0 = js("return rowsOf(S.engine);"); assume0 = js("return JSON.stringify(S.plan.assumptions || null);")
    js("return pickDate(%s, %s);" % (json.dumps(fenv), json.dumps(fd["before"] if fd else ""))); wait(800)
    ush = js("return sheet();"); asked = js("return snap();")
    shot("sheet-until")
    check("a date picked for a place asks first, with each place's last picking before and after and the season's worth as the engine works them out on the plan with that date set, and nothing changes while it asks", bool(fd) and bool(ush) and isinstance(ush.get("moves"), dict) and ush["moves"] == uwant["moves"] and len(uwant["moves"]) > 0 and abs(ush["was"] - uwant["was"]) < 0.005 and abs(ush["now"] - uwant["now"]) < 0.005 and ush["beds"] == uwant["beds"] and asked["undo"] == 0 and asked["key"] == snap0["key"], {"sheet": ush.get("moves") if ush else None, "engine": uwant["moves"]})
    answer(False)
    check("Cancel changes nothing, and the box goes back to the day in force", js("return snap();")["key"] == snap0["key"] and js("return untilCells();")[fenv]["value"] == js("return untilWant(S.engine, %s, [%s]);" % (json.dumps(fid), json.dumps(fenv)))[fenv]["value"])
    js("return pickDate(%s, %s);" % (json.dumps(fenv), json.dumps(fd["before"] if fd else ""))); wait(800); answer(True, 1200)
    ust = last_step(); ugot = js("return { assume: JSON.stringify(S.plan.assumptions || null), crops: JSON.stringify(S.plan.crops || null), rows: rowsOf(S.engine), until: untilCells(), ends: cardEnds(), toast: ($('toast') || {}).textContent || '' };")
    check("agreed, it is one step of the list's own: the crop's line holds that month and day for that place, and nothing else in the plan is written", ust["n"] == 1 and ust["kinds"] == ["assume"] and ugot["assume"] == uwant["assume"] and ugot["crops"] == crops0 and f"{names.get(fid)}," in str(ust["label"]) and "last picking" in str(ust["label"]), {"step": ust})
    bad_crop = js("return sameRows(%s, %s, c => c === %s);" % (json.dumps(ugot["rows"]), json.dumps(uwant["rows"]), json.dumps(fid)))
    bad_rest = js("return sameRows(%s, %s, c => c !== %s);" % (json.dumps(rows0), json.dumps(ugot["rows"]), json.dumps(fid)))
    check("the forecast then is the engine's on that plan, day by day, and every other crop's is as it was; the card shows the date as yours, and the plantings there end on it", bad_crop == [] and bad_rest == [] and ugot["until"][fenv]["value"] == (fd["before"] if fd else None) and ugot["until"][fenv]["whose"] == "yours" and ugot["ends"] == uwant["ends"] and uwant["ends"][fenv]["to"] == (fd["before"] if fd else None), {"crop": bad_crop, "rest": bad_rest[:3] if isinstance(bad_rest, list) else bad_rest, "until": ugot["until"].get(fenv)})
    # a date kept for a place the crop is not planted in keeps that place's column, so it can be seen and cleared
    farc = {}
    far = js("const id = %s, envs = ['field', 'tunnel', 'heated', 'tower'], here = new Set(S.plan.plantings.filter(p => p.cropId === id && placeOf(S.engine, p)).map(p => placeOf(S.engine, p))); return envs.find(e => !here.has(e)) || null;" % json.dumps(fid))
    if far:
        js("const p = withUntil(%s, %s, '02-29'); A.revise('A date for a place with no planting', [{ kind: 'assume', before: S.plan.assumptions, after: p.assumptions }]); return 1;" % (json.dumps(fid), json.dumps(far))); wait(900)
        open_crop(sub["plant"], 200); open_crop(fid, 300)
        farc = js("return untilCells();")
    fyear = js("return +S.plan.settings.year;")
    check("a date he kept for a place the crop is not planted in keeps its column on the card, with the date as his; Feb 29, in a year without it, shows as Feb 28, the day the engine reads", bool(far) and far in farc and farc[far]["mine"] == "02-29" and farc[far]["whose"] == "yours" and farc[far]["value"] == (f"{fyear}-02-29" if fyear % 4 == 0 else f"{fyear}-02-28"), {"place": far, "cells": farc if far else None})
    if far: undo_to(1); open_crop(sub["plant"], 200); open_crop(fid, 300)
    # past the frost, in open ground: the frost cuts it short, and the card says so
    uwant2 = js("const id = %s, b = engineOf(withUntil(id, %s, %s)); return { was: worthOf(S.engine), now: worthOf(b), assume: JSON.stringify(b.plan.assumptions || null), ends: ends(b, id) };" % (json.dumps(fid), json.dumps(fenv), json.dumps(fd["past"][5:] if fd else "")))
    js("return pickDate(%s, %s);" % (json.dumps(fenv), json.dumps(fd["past"] if fd else ""))); wait(800)
    ush2 = js("return sheet();")
    if ush2: answer(True, 1200)
    ugot2 = js("return { assume: JSON.stringify(S.plan.assumptions || null), until: untilCells(), ends: cardEnds(), n: S.undo.length };")
    check("a date past the first frost, in open ground, is kept as his, and the card says the frost cuts it short: the plantings there still end on the frost", ugot2["n"] == 2 and ugot2["assume"] == uwant2["assume"] and ugot2["until"][fenv]["whose"] == "yours" and ugot2["until"][fenv]["frost"] is True and ugot2["ends"] == uwant2["ends"] and ugot2["ends"][fenv]["to"] == (fd["frost"] if fd else None), {"until": ugot2["until"].get(fenv), "ends": ugot2["ends"].get(fenv)})
    # the garden closes before the frost: a date past the close ends on it, and the card says the close ends it sooner
    shut = js("const env = %s, close = %s, gs = S.plan.gardens.filter(g => S.plan.beds.some(b => b.gardenId === g.id && S.engine.envOf(b) === env)); A.revise('The gardens close', gs.map(g => ({ kind: 'garden', before: g, after: { ...g, close: close.slice(5) } }))); return gs.length;" % (json.dumps(fenv), json.dumps(fd["before"] if fd else "")))
    wait(900); open_crop(sub["plant"], 200); open_crop(fid, 300)
    ushut = js("return { until: untilCells(), ends: cardEnds(), n: S.undo.length };")
    check("where the garden closes before a date of his, the plantings there end on the close and the card says the close ends it sooner (the frost, after it, is not said)", bool(shut) and ushut["until"][fenv]["whose"] == "yours" and ushut["until"][fenv]["close"] is True and ushut["until"][fenv]["frost"] is False and ushut["ends"][fenv]["to"] == (fd["before"] if fd else None), {"until": ushut["until"].get(fenv), "ends": ushut["ends"].get(fenv)})
    undo_to(2); open_crop(sub["plant"], 200); open_crop(fid, 300)
    js("return pickDate(%s, '');" % json.dumps(fenv)); wait(800)
    if js("return !!sheet();"): answer(True, 1200)
    cleared = js("return { assume: JSON.stringify(S.plan.assumptions || null), until: untilCells(), n: S.undo.length };")
    check("the box cleared goes back to the season's end there: a step of its own, and the line as it was before any date", cleared["n"] == 3 and cleared["assume"] == assume0 and cleared["until"][fenv]["whose"] != "yours" and cleared["until"][fenv]["mine"] == "", cleared)
    undo_to(0)
    check("Undo takes every one back, to the plan as it was opened", js("return snap();")["key"] == snap0["key"] and js("return snap();")["plan"] == snap0["plan"])
    open_crop(cid)

    # ── a variety with harvest days of its own, as an older plan may carry: its plantings keep them, and are not counted as moving ──
    vv = js("const id = %s, used = S.plan.plantings.filter(p => p.cropId === id && p.varietyId && placeOf(S.engine, p) && S.engine.calc(p) && followsP(S.engine, p)), v = used.length ? S.engine.variety(used[0].varietyId) : null; return v && v.cropId === id ? v.id : null;" % json.dumps(cid))
    if isinstance(vv, str):
        js("const v = S.engine.variety(%s); A.revise('A variety with harvest days of its own', [{ kind: 'variety', before: v, after: { ...v, hw: 9 } }]); return 1;" % json.dumps(vv)); wait(900)
        open_crop(sub["plant"], 200); open_crop(cid, 300)
        kv = js("const id = %s; return { card: cardEnds(), engine: ends(S.engine, id), own: ownN(S.engine, id), undo: S.undo.length };" % json.dumps(cid))
        click('#ycCard [data-hook="harvest-days"]', 700); shv = js("return sheet();"); answer(False)
        undo_to(0)
    else: kv, shv = Missing(), Missing()
    check("a planting whose variety carries harvest days of its own keeps them: Last picking leaves it out, and the sheet counts it among those that do not move", isinstance(vv, str) and kv["undo"] == 1 and kv["card"] == kv["engine"] and bool(shv) and shv["own"] == kv["own"] and js("return snap();")["key"] == snap0["key"], {"card": kv.get("card"), "engine": kv.get("engine"), "own": [shv.get("own") if shv else None, kv.get("own")]})

    # ── a planting ripe only after its season's end is never picked: it is not in the forecast, and gives Last picking no date ──
    zz = js("""const id = %s, fol = S.plan.plantings.filter(p => p.cropId === id && placeOf(S.engine, p) && followsP(S.engine, p)).map(p => S.engine.calc(p)).filter(r => r && r.harvestDays > 0).map(r => r.first).sort((a, b) => a - b);
      if (!fol.length) return null; const last = E.addDays(fol[fol.length - 1], -1), md = String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0'), own = (S.plan.crops || []).find(c => c.id === id) || null;
      A.revise('A season that ends before a planting is ripe', [{ kind: 'crop', before: own, after: { ...(own || { id }), harvestUntil: md } }]); return md;""" % json.dumps(cid))
    wait(900); open_crop(sub["plant"], 200); open_crop(cid, 300)
    kz = js("const id = %s, never = S.plan.plantings.filter(p => p.cropId === id && placeOf(S.engine, p) && followsP(S.engine, p) && S.engine.calc(p) && !(S.engine.calc(p).harvestDays > 0)).length; return { card: cardEnds(), engine: ends(S.engine, id), never, undo: S.undo.length };" % json.dumps(cid))
    # picked for a set number of days, it is picked after all: the sheet says "not picked" before, and gives a date only after
    wz = js("const id = %s, b = engineOf(withDays(id, offerOf(id))); return moves(S.engine, b, id);" % json.dumps(cid))
    click('#ycCard [data-hook="harvest-days"]', 700); shz = js("return sheet();"); answer(False)
    undo_to(0)
    check("a change that has such a planting picked after all says it was not picked before, and gives no date it never had", bool(shz) and isinstance(wz, dict) and shz["moves"] == wz and any(x["wasNone"] > 0 for x in wz.values()) and "not picked" in str(shz["text"]), {"sheet": shz.get("moves") if shz else None, "engine": wz})
    check("a planting ripe only after its season's end is never picked: Last picking gives it no date, as the forecast counts nothing of it", isinstance(zz, str) and kz["undo"] == 1 and kz["never"] > 0 and kz["card"] == kz["engine"] and js("return snap();")["key"] == snap0["key"], {"card": kz.get("card"), "engine": kz.get("engine"), "never": kz.get("never")})

    # ── the same, typed on the list ──
    click('[data-ah-way="list"]', 700)
    typed(f'#ahBody [data-hk="days|{cid}"]', str(offer), "Tab", 900)
    sh2 = js("return sheet();")
    answer(True, 1200)
    st2 = last_step(); got2 = js("return JSON.stringify(S.plan.assumptions || null);")
    check("typed on the list, the number asks with the same sheet and is the same step, leaving the same plan", bool(sh2) and isinstance(sh2.get("moves"), dict) and st2["label"] == st["label"] and st2["n"] == 1 and got2 == plan_card, {"step": st2})
    undo_to(0); click('[data-ah-way="card"]', 600)
    check("and Undo takes it back", js("return snap();")["key"] == snap0["key"])

    # ── a crop picked for a number of days, set to the season's end ──
    cid = sub["days"]; open_crop(cid)
    want = js("const id = %s, b = engineOf(withSeason(id)); return { moves: moves(S.engine, b, id), was: worthOf(S.engine), now: worthOf(b), beds: twice(S.engine, b), own: ownN(S.engine, id), ends: ends(b, id), crops: JSON.stringify(b.plan.crops || null), assume: JSON.stringify(b.plan.assumptions || null), rows: rowsOf(b) };" % json.dumps(cid))
    rows0 = js("return rowsOf(S.engine);")
    click('#ycCard [data-hook="harvest-season"]', 700)
    sh = js("return sheet();")
    shot("sheet-season")
    check("to the season's end asks first too, with each place's last picking before and after as the engine works it out on the plan with the crop's record set so", bool(sh) and isinstance(sh.get("moves"), dict) and sh["moves"] == want["moves"] and len(want["moves"]) > 0 and sh["own"] == want["own"] and js("return snap();")["undo"] == 0, {"sheet": sh.get("moves") if sh else None, "engine": want["moves"]})
    check("and with the season's worth before and after, and the beds it would book twice, as the engine has them", bool(sh) and abs(sh["was"] - want["was"]) < 0.005 and abs(sh["now"] - want["now"]) < 0.005 and sh["beds"] == want["beds"], {"sheet": [sh.get("was"), sh.get("now"), sh.get("beds")], "engine": [want["was"], want["now"], want["beds"]]})
    answer(True, 1200)
    st = last_step(); got = js("const id = %s; return { crops: JSON.stringify(S.plan.crops || null), assume: JSON.stringify(S.plan.assumptions || null), rows: rowsOf(S.engine), ch: cardChoice(), ends: cardEnds(), toast: ($('toast') || {}).textContent || '' };" % json.dumps(cid))
    check("agreed, it is one step: the crop's own record says to the season's end (harvestMode), every other field of it kept, and nothing else in the plan is written", st["n"] == 1 and "crop" in st["kinds"] and st["label"] == f"{names.get(cid)}: picked to the season’s end" and got["crops"] == want["crops"] and got["assume"] == want["assume"], {"step": st, "crops": [got["crops"], want["crops"]] if got["crops"] != want["crops"] else "same", "assume": [got["assume"], want["assume"]] if got["assume"] != want["assume"] else "same"})
    bad_crop = js("return sameRows(%s, %s, c => c === %s);" % (json.dumps(got["rows"]), json.dumps(want["rows"]), json.dumps(cid)))
    bad_rest = js("return sameRows(%s, %s, c => c !== %s);" % (json.dumps(rows0), json.dumps(got["rows"]), json.dumps(cid)))
    check("the forecast then is the engine's on that plan, day by day, and every other crop's is as it was", bad_crop == [] and bad_rest == [] and isinstance(got["rows"], dict) and len(got["rows"]) > 20, {"crop": bad_crop, "rest": bad_rest[:4] if isinstance(bad_rest, list) else bad_rest})
    check("the card then stands on the season's end, and Last picking shows the season's end in each place", got["ch"]["on"] == "season" and got["ch"]["season"] == "true" and got["ends"] == want["ends"] and "season’s worth" in got["toast"], {"choice": got["ch"], "ends": [got["ends"], want["ends"]]})
    undo_to(0); back = js("return { snap: snap(), ch: cardChoice() };")
    check("Undo puts the plan back as it was, the crop's record with it, and the choice back to its days", back["snap"]["key"] == snap0["key"] and back["snap"]["plan"] == snap0["plan"] and back["ch"]["on"] == "days", back["ch"])
    end = js("return snap();")
    check("at the end the plan is as it was opened", end["key"] == snap0["key"] and end["plan"] == snap0["plan"])
    finish()
