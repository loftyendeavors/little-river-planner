"""Yield and price, one crop at a time, in a real browser: the checklist, the card and its boxes, the tick, the house's share,
fast entry, and "All on one page". Every figure the card shows is held against the engine and the forecast made in the page,
and what a box writes against what the list's own box writes. It finds its subjects on the plan it is given.
usage: python3 -I yieldcard_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, STOP_AT_FAIL=1
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
PLACES = ["field", "tunnel", "heated", "tower", "tray"]
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, $ = id => document.getElementById(id), txt = id => ($(id) || {}).textContent || '';"
       "const worthOf = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0), money = n => '$' + Math.round(n).toLocaleString('en-US');"
       # the page's way of writing a figure, written out again here
       "const fig = n => n == null || !Number.isFinite(+n) ? '' : String(+(+n).toFixed(Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : Math.abs(n) >= 0.1 ? 2 : 3));"
       "const PLACES = ['field', 'tunnel', 'heated', 'tower', 'tray'];"
       "const placeOf = p => { const b = S.engine.bedOf(p.bedId); return !b ? null : S.engine.isRack(b) ? 'tray' : S.engine.envOf(b) || 'tray'; };"
       "const placesOf = id => { const set = new Set(); for (const p of S.plan.plantings) if (p.cropId === id) { const e = placeOf(p); if (e) set.add(e); } return PLACES.filter(e => set.has(e)); };"
       "const mine = () => { const u = new Map(); for (const p of S.plan.plantings) u.set(p.cropId, (u.get(p.cropId) || 0) + 1); const list = S.plan.settings.cropTypeList || {}; return S.engine.crops().filter(c => LRFPanels.isMine(c, u, c.micro ? [] : S.engine.varietiesOf(c.id), list)); };"
       "const waits = c => { const hc = S.engine.harvestFor(c.id); return S.engine.isCoverCrop(c) ? { price: false, yield: false } : { price: hc.open.price && hc.price.mine == null, yield: hc.open.yield && S.engine.ENVS.every(e => hc.cells[e].mine == null) }; };"
       # every planting's dates, and what it gives and at what price: what "no figure changed" means
       "const sig = () => { const e = S.engine, out = []; for (const p of S.plan.plantings) { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null; out.push(r ? [p.id, E.d2s(r.sow), E.d2s(r.field), E.d2s(r.first), E.d2s(r.last), y ? y.units : null, y ? y.price : null, y ? y.unit : null].join('|') : p.id); } return out.join('\\n'); };"
       "const snap = () => ({ key: A.contentKey(), undo: S.undo.length, plan: JSON.stringify({ ...S.plan, lrfNext: null }), sig: sig(), worth: worthOf(S.engine) });"
       # the plan with every tick taken out of it
       "const unticked = () => { const p = JSON.parse(JSON.stringify({ ...S.plan, lrfNext: null })); const sell = (p.assumptions || {}).sell || {}; for (const id of Object.keys(sell)) { delete sell[id].looked; if (!Object.keys(sell[id]).length) delete sell[id]; } if (p.assumptions && p.assumptions.sell && !Object.keys(p.assumptions.sell).length) delete p.assumptions.sell; if (p.assumptions && !['crops', 'varieties', 'starts', 'sell', 'sellV'].some(k => p.assumptions[k] && Object.keys(p.assumptions[k]).length)) delete p.assumptions; return JSON.stringify(p); };"
       "const seen = el => !!el && el.offsetParent !== null;"
       # what the card on show says
       "const card = () => { const c = $('ycCard'); if (!seen(c) || !$('ycGrid')) return c && seen(c) ? { crop: c.dataset.crop, plain: txt('ycPlain') } : null;"
       " const box = el => ({ value: el.value, placeholder: el.placeholder || '', amber: !!el.closest('.yc-box.amber'), mine: !!el.closest('.yc-box.mine, .yc-sel.mine'), tag: el.tagName, label: el.getAttribute('aria-label') || '' });"
       " const rows = {}; for (const tr of c.querySelectorAll('#ycGrid tbody tr')) { const cells = [...tr.querySelectorAll('td')]; rows[tr.dataset.row] = { label: tr.querySelector('th b').textContent, hint: (tr.querySelector('th small') || {}).textContent || '', cells: cells.map(td => ({ place: td.dataset.place || null, span: td.colSpan, text: td.innerText.replace(/\\s+/g, ' ').trim(), inputs: td.querySelectorAll('input, select').length, na: (td.querySelector('.yc-na') || {}).textContent || '', dtm: (td.querySelector('[data-dtm]') || { dataset: {} }).dataset.dtm || null, mark: (td.querySelector('.yc-mark') || {}).textContent || '', total: td.querySelector('.yc-total') ? { ...td.querySelector('.yc-total').dataset, text: td.querySelector('.yc-total').textContent } : null })) }; }"
       " const boxes = {}; for (const el of c.querySelectorAll('[data-yk]')) boxes[el.dataset.yk] = box(el);"
       " const house = $('ycHouse'), next = $('ycNext');"
       " return { crop: c.dataset.crop, name: txt('ycName'), where: txt('ycWhere'), state: txt('ycState'), cols: [...c.querySelectorAll('#ycGrid thead th[data-place]')].map(th => th.dataset.place), heads: [...c.querySelectorAll('#ycGrid thead th[data-place]')].map(th => th.innerText.replace(/\\s+/g, ' ').trim()), order: Object.keys(rows), rows, boxes,"
       "  house: house ? { text: house.innerText.replace(/\\s+/g, ' ').trim(), why: txt('ycHouseWhy') } : null, comes: [...c.querySelectorAll('#ycComes p[data-unit]')].map(p => ({ unit: p.dataset.unit, total: +p.dataset.total, worth: +p.dataset.worth, text: p.textContent })), comesText: ($('ycComes') || {}).innerText || '', waits: [...c.querySelectorAll('#ycWaits li')].map(li => li.textContent), waitsText: ($('ycWaits') || {}).innerText || '',"
       "  next: next ? { text: next.textContent, id: next.dataset.next } : null, untick: !!$('ycUntick'), focus: document.activeElement && c.contains(document.activeElement) ? (document.activeElement.dataset.yk || document.activeElement.id) : null }; };"
       # the checklist on show
       "const side = () => { const items = [...document.querySelectorAll('#ycList .yc-item')]; return { items: items.map(b => ({ id: b.dataset.crop, done: b.classList.contains('done'), open: b.classList.contains('open'), cur: b.getAttribute('aria-current') === 'true', say: b.querySelector('small').textContent, name: b.querySelector('b').textContent })), secs: [...document.querySelectorAll('#ycList .yc-sec')].map(x => x.textContent), prog: ($('ycProg') || {}).innerText || '', looked: +(($('ycProg') || { dataset: {} }).dataset.looked), of: +(($('ycProg') || { dataset: {} }).dataset.of), left: +(($('ycLeft') || { dataset: {} }).dataset.left), leftText: txt('ycLeft'), meter: (document.querySelector('.yc-meter i') || { style: {} }).style.width || '' }; };"
       # what the forecast makes of one crop, and what the engine makes of the plantings that follow its line in one place
       "const forecast = id => { const rows = F.build(S.engine).rows.filter(r => r.cropId === id && r.total > 0); return rows.map(r => ({ unit: r.unit, total: r.total, worth: r.worth })); };"
       "const perIn = (id, env) => { const out = []; for (const p of S.plan.plantings) { if (p.cropId !== id || placeOf(p) !== env) continue; const r = S.engine.calc(p), y = r ? S.engine.yieldOf(p, r) : null; if (y && !y.own && y.by !== 'variety' && y.set) out.push({ per: y.per, week: y.perWeek, days: r.harvestDays }); } return out; };"
       "const fits = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5; };")
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
        """What a reading gives when the thing read is not on the page (a fault took it away): it is false, equals nothing, holds
        nothing and can be asked for anything, so the named line that reads it fails and the check goes on to its end."""
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
        def __add__(self, o): return Missing()
        __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = __add__
        def __abs__(self): return 0
        def __float__(self): return float("nan")
        def startswith(self, x): return False
        def split(self, *a): return []
        def lower(self): return ""
        def __str__(self): return "(not there)"
    def soft(v):
        """A reading with everything that is not there turned into Missing, however deep."""
        if v is None: return Missing()
        if isinstance(v, dict): return type("Soft", (dict,), {"__getitem__": lambda s, k: dict.get(s, k, Missing()), "get": lambda s, k, d=None: dict.get(s, k, Missing() if d is None else d)})({k: soft(x) for k, x in v.items()})
        if isinstance(v, list): return [soft(x) for x in v]
        return v
    def nth(seq, i):
        """The i-th of a list, or Missing where the list is too short: a fault that empties the checklist fails named lines."""
        return seq[i] if isinstance(seq, list) and -len(seq) <= i < len(seq) else Missing()
    def js(body):
        try:
            return soft(page.evaluate("(() => { " + PRE + " " + body + " })()"))
        except Exception as e:
            errors.append(str(e)[:200]); return Missing()
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0 and page.locator(sel).first.is_visible()
    def click(sel, ms=350):   # a thing a fault has removed is not clicked: the named line after it fails, and the check goes on
        if not has(sel): wait(100); return False
        try: page.locator(sel).first.click(timeout=4000)
        except Exception: return False
        wait(ms); return True
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    def card(): return js("return card();")
    def side(): return js("return side();")
    def snap(): return js("return snap();")
    def open_crop(cid, ms=250):
        """Open a crop's card as a hand does: by its line of the checklist."""
        return click(f'#ycList .yc-item[data-crop="{cid}"]', ms)
    def asking(): return js("const d = document.querySelector('dialog[open]'); return d ? { title: (d.querySelector('h2') || {}).textContent || '', text: d.innerText } : null;")
    def answer(yes, ms=500):
        ok = click("dialog[open] .btn.primary" if yes else "dialog[open] .dialog-actions .btn:not(.primary)", ms)
        return ok
    def undo_to(n, ms=250):
        """Undo back to n steps, and no further."""
        for _ in range(60):
            if js("return S.undo.length;") in (n, Missing()) or not (js("return S.undo.length;") > n): break
            js("A.undo(); return 1;"); wait(ms)
    def typed(sel, text, key="Tab", ms=500):
        """Type into a box as a hand does: click it, select what is there, type, and leave with a key."""
        if not has(sel): wait(100); return False
        page.locator(sel).first.click(); page.keyboard.press("Control+a")
        if text == "": page.keyboard.press("Delete")
        else: page.keyboard.type(text)
        if key: page.keyboard.press(key)
        wait(ms); return True
    def last_step(): return js("const u = S.undo[S.undo.length - 1]; return u ? { label: u.label, n: S.undo.length, kinds: u.ops.map(o => o.kind || 'planting') } : { label: '', n: 0, kinds: [] };")

    start = js("return { n: S.plan.plantings.length, undo: S.undo.length, label: txt('buildNote'), sample: A.isSample(), year: A.planYear(), mine: mine().length, all: S.engine.crops().length, marks: JSON.stringify(S.plan.assumptions || null).includes('looked') || JSON.stringify(S.plan.assumptions || null).includes('house'), farm: S.plan.settings.houseKeeps };")
    year = start["year"]
    check("a plan is open, there is nothing to undo, and the build says its own label", start["n"] > 300 and start["undo"] == 0 and (os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)") in start["label"] and not start["sample"], start)
    check("the plan as it is opened holds no tick, no mark for the house and no switch: nothing was added by opening it", start["marks"] is False and not isinstance(start["farm"], bool), start)
    snap0 = snap()

    # ── the page opens on one crop at a time ──
    page.evaluate("LRFApp.setView('assume')"); wait(600)
    first = js("return { days: !$('asTable').hidden, card: seen($('ycHost')), way: seen($('ahWay')), house: seen($('ahHouseFarm')), title: txt('asTitle') };")
    check("the Assumptions view still opens on days to harvest, with nothing of the card on it", first == {"days": True, "card": False, "way": False, "house": False, "title": "Days to first harvest"}, first)
    click('[data-as-mode="harvest"]', 700)
    opened = js("return { table: seen($('ahTable')), days: seen($('asTable')), card: seen($('ycHost')), title: txt('asTitle'), way: [...document.querySelectorAll('[data-ah-way]')].map(b => [b.dataset.ahWay, b.textContent.trim(), b.getAttribute('aria-pressed')]), lead: txt('asLead'), open: seen($('ahOpen')) };")
    check("“Yield and price” opens one crop at a time, with “All on one page” beside it as the other way", opened["card"] is True and opened["table"] is False and opened["days"] is False and opened["title"] == "Yield and price" and opened["way"] == [["card", "One crop at a time", "true"], ["list", "All on one page", "false"]], opened)
    s0 = side(); c0 = card()
    want = js("const m = mine(), w = m.filter(c => { const x = waits(c); return x.price || x.yield; }); return { mine: m.map(c => c.id).sort(), left: w.map(c => c.id).sort(), worth: Object.fromEntries(m.map(c => [c.id, forecast(c.id).reduce((n, r) => n + r.worth, 0)])) };")
    ids = [i["id"] for i in s0["items"]]
    check("down the left every crop of “My crops” is on the checklist, once", len(ids) > 20 and sorted(ids) == want["mine"] and len(set(ids)) == len(ids), {"listed": len(ids), "mine": len(want["mine"])})
    nleft = len(want["left"])
    check("the crops with no price or no yield come first, and the page says how many are left", nleft > 0 and sorted(ids[:nleft]) == want["left"] and s0["left"] == nleft and str(nleft) in s0["leftText"] and "left to set" in s0["leftText"] and all(i["open"] for i in s0["items"][:nleft]) and not any(i["open"] for i in s0["items"][nleft:]) and s0["secs"] == ["No price or no yield", "The rest, biggest first"], {"left": s0["left"], "want": nleft, "text": s0["leftText"], "headings": s0["secs"]})
    check("the page opens on the first of them", [c0["crop"]] == ids[:1] and c0["crop"] in want["left"] and nth(s0["items"], 0)["cur"] is True, {"card": c0["crop"], "first": ids[:1]})
    rest = [want["worth"][i] for i in ids[nleft:]]
    check("the rest follow, biggest first: by what each is worth over the season in the forecast", len(rest) > 10 and all(rest[k] >= rest[k + 1] - 1e-6 for k in range(len(rest) - 1)), rest[:8])
    check("a bar says how many are looked at for the year: none yet", s0["looked"] == 0 and s0["of"] == len(ids) and f"0 of {len(ids)}" in s0["prog"] and f"looked at for {year}" in s0["prog"] and s0["meter"] in ("0%", "0"), s0["prog"])
    check("nothing is ticked, and each crop that has a price and a yield says what it is worth", not any(i["done"] for i in s0["items"]) and len(s0["items"]) > nleft + 6 and all(i["say"] == js("return money(%s);" % want["worth"][i["id"]]) for i in s0["items"][nleft:nleft + 6] if want["worth"][i["id"]] >= 0.5), s0["items"][nleft:nleft + 3])
    shot("card")

    # ── subjects, found on the plan ──
    sub = js("""const m = mine().filter(c => placesOf(c.id).length), hc = c => S.engine.harvestFor(c.id), w = waits, set = c => !w(c).price && !w(c).yield && !hc(c).micro;
      const pick = f => (m.find(f) || {}).id || null, own = id => S.plan.plantings.filter(p => p.cropId === id && p.yield != null && p.yield !== '').length;
      return { multi: pick(c => set(c) && placesOf(c.id).length >= 3) || pick(c => set(c) && placesOf(c.id).length >= 2), single: pick(c => set(c) && placesOf(c.id).length === 1 && hc(c).basis === 'plant' && !hc(c).season),
        season: pick(c => set(c) && hc(c).season && placesOf(c.id).length >= 2) || pick(c => set(c) && hc(c).season), ft: pick(c => set(c) && hc(c).basis === 'ft'), micro: pick(c => hc(c).micro),
        noprice: pick(c => w(c).price && !w(c).yield), loose: pick(c => w(c).yield && !w(c).price), both: pick(c => w(c).price && w(c).yield),
        head: pick(c => set(c) && hc(c).basis === 'plant' && ['each', 'head'].includes(hc(c).unit.value) && placesOf(c.id).every(e => hc(c).cells[e] && hc(c).cells[e].value != null && hc(c).cells[e].value <= 1) && !own(c.id)),
        under: pick(c => set(c) && hc(c).share.value < 100 && !own(c.id)), names: Object.fromEntries(mine().map(c => [c.id, c.name])) };""")
    names = sub["names"]
    check("the plan has a crop of each kind to look at: in several places, in one, picked to the season's end, counted by the bed-foot, a live tray, with no price, with no yield, with neither, sold by the head", all(isinstance(sub[k], str) for k in ("multi", "single", "season", "ft", "micro", "noprice", "loose", "both", "head", "under")), {k: v for k, v in sub.items() if k != "names"})

    # ── the list, read once: what "All on one page" shows for every crop ──
    click('[data-ah-way="list"]', 700)
    listed = js("""const out = {}; for (const el of document.querySelectorAll('#ahBody tr.as-crop [data-hk]')) out[el.dataset.hk] = { value: el.value, placeholder: el.placeholder || '', mine: !!el.closest('td').classList.contains('mine') || el.classList.contains('mine'), away: !!el.closest('.ah-away') };
      return { cells: out, table: seen($('ahTable')), card: seen($('ycHost')), rows: document.querySelectorAll('#ahBody tr.as-crop').length, pressed: document.querySelector('[data-ah-way=list]').getAttribute('aria-pressed'), note: seen($('ahOpen')), sold: [...document.querySelectorAll('#ahHead th')].filter(th => seen(th)).map(th => th.textContent).includes('Sold %') };""")
    check("“All on one page” is the list as it was: every crop a row, the card put away", listed["table"] is True and listed["card"] is False and listed["rows"] == len(ids) and listed["pressed"] == "true" and listed["sold"] is True, {k: v for k, v in listed.items() if k != "cells"})
    L = listed["cells"]
    away = js("""const out = { shown: 0, quiet: 0, wrong: [] }; for (const c of mine()) { const hc = S.engine.harvestFor(c.id), at = placesOf(c.id); if (hc.micro) continue; for (const env of S.engine.ENVS) { const el = document.querySelector(`#ahBody [data-hk="y|crops|${c.id}|${env}"]`); if (!el) continue; const planted = !at.length || at.includes(env) || hc.cells[env].mine != null, says = el.value !== '' || el.placeholder !== ''; if (planted) out.shown++; else out.quiet++; if (planted !== says && hc.cells[env].value != null) out.wrong.push(c.name + ' ' + env); } } return out;""")
    check("on the list a yield is shown only for a place the crop is planted in: the other boxes stay, empty", away["shown"] > 20 and away["quiet"] > 20 and away["wrong"] == [], away)
    click('[data-ah-way="card"]', 600)

    # ── every crop's card, against the plan, the engine, the forecast and the list ──
    class Walk(dict):
        def __missing__(self, k): return Missing()   # a crop the checklist did not hold: every line that reads it fails by name
    walk = Walk()
    for cid in ids:
        open_crop(cid, 60)
        walk[cid] = js("""const id = %s, c = S.engine.crop(id), hc = S.engine.harvestFor(id), k = card(), at = placesOf(id);
          return { card: k, places: at.length ? at : hc.micro ? ['tray'] : S.engine.ENVS.filter(e => hc.cells[e].used), planted: at.length > 0, micro: hc.micro, basis: hc.basis, pattern: hc.pattern.value, season: hc.season, unit: hc.unit.value, waits: waits(c), share: hc.share.value, days: hc.days.value,
            dtm: Object.fromEntries(S.engine.ENVS.map(e => [e, (S.engine.timingFor(id, null, e) || {}).value])), forecast: forecast(id), cells: Object.fromEntries(S.engine.ENVS.map(e => [e, hc.cells[e]])), cur: (side().items.find(i => i.cur) || {}).id };""" % json.dumps(cid))
    w_ok = [cid for cid in ids if walk[cid]["card"]["crop"] == cid and walk[cid]["cur"] == cid]
    check("a click on any crop of the checklist opens that crop's card", len(w_ok) == len(ids), [names.get(c) for c in ids if c not in w_ok][:5])
    bad = [names.get(c) for c in ids if walk[c]["card"]["cols"] != walk[c]["places"]]
    check("a column for each growing place the crop is planted in, and for no other", bad == [] and sum(1 for c in ids if walk[c]["planted"]) > 20, bad[:6])
    idle = [c for c in ids if not walk[c]["planted"]]
    check("a crop that is not planted this season says so, and has a column for each place the farm has, so that it can still be set", all("Not planted" in walk[c]["card"]["where"] and all("not planted yet" in h.lower() for h in walk[c]["card"]["heads"]) and len(walk[c]["card"]["cols"]) >= 1 for c in idle), [names.get(c) for c in idle][:4])
    bad = [names.get(c) for c in ids if walk[c]["card"]["order"] != ["unit", "price", "yield", "first", "pick", "last"]]
    check("a row for each figure, in one order on every card: sold by, price, what it gives, first picking, picked, last picking", bad == [], bad[:6])
    def same_as_list(c):
        k = walk[c]["card"]["boxes"]; out = []
        for yk, hk in [("price", f"price|{c}"), ("unit", f"unit|{c}"), ("pick", f"pick|{c}"), ("days", f"days|{c}")] + [(f"y|{e}", f"y|crops|{c}|{e}") for e in walk[c]["places"] if e != "tray"]:
            a, b = k.get(yk, None), L.get(hk, None)
            if walk[c]["micro"]:
                if yk in ("unit", "pick", "days") or yk.startswith("y|"):
                    if isinstance(a, dict) and len(a): out.append(yk + " is a box on a live tray")
                    continue
            if not (isinstance(a, dict) and len(a)) or not (isinstance(b, dict) and len(b)): out.append(yk + " missing"); continue
            if a["value"] != b["value"] or bool(a["mine"]) != bool(b["mine"]): out.append(f"{yk}: {a['value']!r} against the list's {b['value']!r}")
            # what stands in grey: the same figure, unless the box is amber, which is empty on purpose
            if not a["amber"] and a["placeholder"] != b["placeholder"] and not (yk == "price" and b["placeholder"] in ("0", "")): out.append(f"{yk}: grey {a['placeholder']!r} against the list's {b['placeholder']!r}")
        return out
    bad = {names.get(c): same_as_list(c) for c in ids if same_as_list(c)}
    check("the card and the list show the same figures: price, unit, how it is picked, harvest days, and the yield in each place", bad == {}, dict(list(bad.items())[:4]))
    def amber_ok(c):
        k = walk[c]["card"]["boxes"]; w = walk[c]["waits"]; out = []
        for yk, b in k.items():
            if b["tag"] != "INPUT": continue
            should = (yk == "price" and w["price"]) or (yk.startswith("y|") and w["yield"])
            if bool(b["amber"]) != bool(should): out.append(f"{yk} amber {b['amber']}")
            if b["amber"] and (b["value"] != "" or b["placeholder"] != ""): out.append(f"{yk} amber and not empty")
        return out
    bad = {names.get(c): amber_ok(c) for c in ids if amber_ok(c)}
    n_amber = sum(1 for c in ids for b in walk[c]["card"]["boxes"].values() if b["amber"])
    check("a box only the grower can fill is amber and empty, and no other box is: the price of a crop with none, the yield of a crop nobody has checked", bad == {} and n_amber >= 3, {"bad": dict(list(bad.items())[:4]), "amber": n_amber})
    def first_ok(c):
        r = walk[c]["card"]["rows"]["first"]; out = []
        if r["label"] != "First picking": out.append(r["label"])
        for cell in r["cells"]:
            if cell["inputs"]: out.append("a box")
            if walk[c]["micro"]:
                if "tray plan" not in cell["na"]: out.append("no reason")
            elif cell["dtm"] != str(walk[c]["dtm"][cell["place"]]) or cell["mark"] != "DTM" or "days after" not in cell["text"]: out.append(f"{cell['place']}: {cell['dtm']} against {walk[c]['dtm'][cell['place']]}")
        return out
    bad = {names.get(c): first_ok(c) for c in ids if first_ok(c)}
    check("first picking is shown, not typed: the crop's DTM for each place, with the mark “DTM”", bad == {}, dict(list(bad.items())[:4]))
    def comes_ok(c):
        got = {x["unit"]: x for x in walk[c]["card"]["comes"]}; f = walk[c]["forecast"]; out = []
        if sorted(got) != sorted(x["unit"] for x in f): out.append("units")
        for x in f:
            g = got.get(x["unit"])
            if not g or abs(g["total"] - x["total"]) > 1e-6 or abs(g["worth"] - x["worth"]) > 1e-6 or js("return money(%s);" % x["worth"]) not in g["text"]: out.append(x["unit"])
        return out
    bad = {names.get(c): comes_ok(c) for c in ids[:nleft + 14] if comes_ok(c)}
    check("under the grid, what it comes to is the forecast's own figure for the crop: how much there is to sell, and what that is worth", bad == {}, dict(list(bad.items())[:4]))
    bad = [names.get(c) for c in ids if (walk[c]["waits"]["price"] and not any(t.startswith("A price") for t in walk[c]["card"]["waits"])) or (walk[c]["waits"]["yield"] and not any(t.startswith("A yield") for t in walk[c]["card"]["waits"])) or (not walk[c]["waits"]["price"] and any(t.startswith("A price") for t in walk[c]["card"]["waits"]))]
    check("and what it waits on names the price or the yield that is not set, for the crops that lack one and no other", bad == [], bad[:6])
    def house_wrong(c):
        h = walk[c]["card"]["house"]; part = (not walk[c]["micro"]) and walk[c]["share"] < 100
        if not part: return bool(h)   # a line that should not be there
        b = walk[c]["card"]["boxes"].get("house", None)
        return not (bool(h) and bool(b) and "The house keeps" in h["text"] and "% of what is packed" in h["text"] and (b["value"] or b["placeholder"]) == js("return fig(%s);" % (100 - walk[c]["share"])) and f"{js('return fig(%s);' % walk[c]['share'])}%" in h["why"])
    bad = [names.get(c) for c in ids if house_wrong(c)]
    n_house = sum(1 for c in ids if walk[c]["card"]["house"])
    check("“The house keeps [n] % of what is packed” is on the card of a crop that sells less than all of it today, with n what is left, and on no other", bad == [] and n_house > 10, {"bad": bad[:6], "with": n_house})
    k = walk[sub["multi"]]["card"]
    check("a crop grown in several places has a yield box for each, and one unit and one price across them all", len(k["cols"]) >= 2 and len(k["rows"]["yield"]["cells"]) == len(k["cols"]) and [c["place"] for c in k["rows"]["yield"]["cells"]] == k["cols"] and all(c["inputs"] == 1 for c in k["rows"]["yield"]["cells"]) and len(k["rows"]["unit"]["cells"]) == 1 and nth(k["rows"]["unit"]["cells"], 0)["span"] == len(k["cols"]) and nth(k["rows"]["price"]["cells"], 0)["span"] == len(k["cols"]) and "wherever it grows" in k["rows"]["unit"]["hint"], k["rows"]["yield"])
    k = walk[sub["single"]]["card"]; kf = walk[sub["ft"]]["card"]
    check("the label of a yield box says what the box means: packed, from a plant, or from a bed-foot where the crop is counted so", k["rows"]["yield"]["label"] == "Gives, packed, a plant" and "in all" in k["rows"]["yield"]["hint"] and kf["rows"]["yield"]["label"] == "Gives, packed, a bed-foot" and walk[sub["ft"]]["basis"] == "ft", [k["rows"]["yield"], kf["rows"]["yield"]["label"]])
    k = walk[sub["micro"]]["card"]
    check("a live tray's card has one column, a price to type, and says why the rest is not asked: a tray is a tray", k["cols"] == ["tray"] and "living trays" in str(nth(k["heads"], 0)).lower() and sorted(k["boxes"]) == ["price"] and "a tray is a tray" in nth(k["rows"]["yield"]["cells"], 0)["na"] and "tray" in nth(k["rows"]["unit"]["cells"], 0)["na"] and nth(k["rows"]["pick"]["cells"], 0)["na"] != "" and not k["house"], {"cols": k["cols"], "boxes": sorted(k["boxes"])})
    k = walk[sub["season"]]["card"]
    check("a crop picked to the end of the season says so where its last picking would be, and its harvest days stand empty", all("season ends" in c["na"] for c in k["rows"]["last"]["cells"]) and k["boxes"]["days"]["value"] == "" and k["boxes"]["days"]["placeholder"] == "season", k["rows"]["last"])
    k = walk[sub["single"]]["card"]
    check("a crop picked for a set number of days says its last picking is that many days after the first", all(c["text"].startswith(str(walk[sub["single"]]["days"])) and "days after the first" in c["text"] for c in k["rows"]["last"]["cells"]), k["rows"]["last"])
    look = js("const c = $('ycCard'), g = $('ycGrid'); return { card: fits(c), side: fits(document.querySelector('.yc-side')), sideways: document.documentElement.scrollWidth > innerWidth, spill: c.scrollWidth > c.clientWidth + 1, grid: g.scrollWidth > g.clientWidth + 1, next: fits($('ycNext')), cut: [...c.querySelectorAll('#ycGrid th, #ycGrid td')].filter(x => x.scrollWidth > x.clientWidth + 1).length };")
    open_crop(sub["multi"], 300)
    look2 = js("const c = $('ycCard'), g = $('ycGrid'); return { card: fits(c), sideways: document.documentElement.scrollWidth > innerWidth, spill: c.scrollWidth > c.clientWidth + 1, cut: [...c.querySelectorAll('#ycGrid th, #ycGrid td')].filter(x => x.scrollWidth > x.clientWidth + 1).length, boxes: [...c.querySelectorAll('.yc-box input')].every(i => i.getBoundingClientRect().width >= 60) };")
    check("the card fits its page at this width: nothing cut, nothing spilling, no scrolling sideways, with one column or with several", look["card"] and look["side"] and not look["sideways"] and not look["spill"] and not look["grid"] and look["cut"] == 0 and look2["card"] and not look2["sideways"] and not look2["spill"] and look2["cut"] == 0 and look2["boxes"], [look, look2])
    shot("card-several-places")
    walked = snap()
    check("opening the page and walking every crop's card changes nothing in the plan, and leaves nothing to undo", walked["key"] == snap0["key"] and walked["plan"] == snap0["plan"] and walked["undo"] == 0, {"undo": walked["undo"]})

    # ── a figure typed on the card is the figure typed on the list ──
    cid = sub["single"]; env = nth(walk[cid]["places"], 0)
    open_crop(cid)
    typed('#ycCard [data-yk="price"]', "7.25"); wait(300)
    a1 = last_step(); k1 = snap(); c1 = card()
    check("a price typed on the card is one step, in the list's words, and the box is then the grower's", a1["n"] == 1 and a1["kinds"] == ["assume"] and names[cid] in a1["label"] and "$7.25" in a1["label"] and c1["boxes"]["price"]["value"] == "7.25" and c1["boxes"]["price"]["mine"] is True, a1)
    check("it is the crop's price in the engine, and nothing else of the plan moved: no date, and no yield of any planting", js("return S.engine.sellRule(%s).price;" % json.dumps(cid)) == 7.25 and [l.rsplit("|", 2)[0] for l in k1["sig"].split("\n")] == [l.rsplit("|", 2)[0] for l in snap0["sig"].split("\n")], a1)
    undo_to(0)
    back = snap()
    click('[data-ah-way="list"]', 600)
    typed(f'#ahBody [data-hk="price|{cid}"]', "7.25"); wait(300)
    b1 = last_step(); k2 = snap()
    check("typed on the list instead, it is the same step and leaves the same plan", back["key"] == snap0["key"] and b1["n"] == 1 and b1["label"] == a1["label"] and k2["key"] == k1["key"] and k2["plan"] == k1["plan"], {"card": a1, "list": b1})
    undo_to(0); click('[data-ah-way="card"]', 600); open_crop(cid)
    typed(f'#ycCard [data-yk="y|{env}"]', "3.4"); wait(300)
    a2 = last_step(); k3 = snap(); c2 = card()
    stored = js("return ((S.plan.assumptions || {}).crops || {})[%s];" % json.dumps(cid))
    check("a yield typed on the card is one step, written for that place and no other", a2["n"] == 1 and a2["kinds"] == ["assume"] and stored == {env: {"yield": 3.4}} and "3.4" in a2["label"] and c2["boxes"][f"y|{env}"]["value"] == "3.4" and c2["boxes"][f"y|{env}"]["mine"] is True, {"step": a2, "stored": stored})
    undo_to(0); click('[data-ah-way="list"]', 600)
    typed(f'#ahBody [data-hk="y|crops|{cid}|{env}"]', "3.4"); wait(300)
    b2 = last_step(); k4 = snap()
    check("typed on the list instead, it is the same step and leaves the same plan", b2["n"] == 1 and b2["label"] == a2["label"] and k4["key"] == k3["key"] and k4["plan"] == k3["plan"], {"card": a2, "list": b2})
    click('[data-ah-way="card"]', 600); open_crop(cid)
    c3 = card()
    check("a figure typed on the list is on the card when it is next opened", c3["boxes"][f"y|{env}"]["value"] == "3.4" and c3["boxes"][f"y|{env}"]["mine"] is True, c3["boxes"])
    typed(f'#ycCard [data-yk="y|{env}"]', ""); wait(300)
    cleared = snap(); c4 = card()
    check("clearing a box goes back to what the plan used before: a second step, and the plan as it was", cleared["undo"] == 2 and cleared["key"] == snap0["key"] and c4["boxes"][f"y|{env}"]["value"] == "" and c4["boxes"][f"y|{env}"]["mine"] is False, {"undo": cleared["undo"]})
    typed(f'#ycCard [data-yk="y|{env}"]', "-2"); wait(200)
    check("a figure that cannot be a yield is not taken", snap()["undo"] == 2 and card()["boxes"][f"y|{env}"]["value"] == "", card()["boxes"])
    undo_to(0)

    # ── picked gradually: a week's figure, and beside it the season's total it comes to ──
    cid = sub["season"]; open_crop(cid)
    if has('#ycCard [data-yk="pick"]'): page.select_option('#ycCard [data-yk="pick"]', "weekly"); wait(600)
    if asking(): answer(True)
    g = last_step(); kw = card()
    opts = js("return [...document.querySelectorAll('#ycCard [data-yk=pick] option')].map(o => [o.value, o.textContent]);")
    check("a crop is picked Gradually, Clear or On demand, in the list's words, and choosing one is the list's own step", opts[:3] == [["weekly", "Gradually"], ["once", "Clear"], ["spread", "On demand"]] and g["n"] == 1 and "picked gradually" in g["label"] and js("return S.engine.sellRule(%s).pattern;" % json.dumps(cid)) == "weekly", {"opts": opts, "step": g})
    check("the box is then a week's picking, and its label says so", kw["rows"]["yield"]["label"] == "Gives, packed, a plant a week" and "each week" in kw["rows"]["yield"]["hint"], kw["rows"]["yield"]["label"])
    eng_tot = {e: js("return perIn(%s, %s);" % (json.dumps(cid), json.dumps(e))) for e in walk[cid]["places"]}
    def total_ok(cell):
        e = eng_tot[cell["place"]]; t = cell["total"]
        if not e or not t: return False
        lo, hi = min(x["per"] for x in e), max(x["per"] for x in e)
        # the engine's figure for each planting, and the same figure worked out here from the week's picking and the days it is picked
        arith = all(abs(x["week"] * x["days"] / 7 - x["per"]) < 1e-9 for x in e)
        return arith and abs(float(t["lo"]) - lo) < 1e-9 and abs(float(t["hi"]) - hi) < 1e-9 and js("return fig(%s);" % lo) in t["text"] and js("return fig(%s);" % hi) in t["text"] and "over the season" in t["text"]
    check("beside each weekly box the season's total it comes to, which is the engine's: the week's figure times the weeks each planting there is picked", len(kw["rows"]["yield"]["cells"]) == len(walk[cid]["places"]) and all(total_ok(c) for c in kw["rows"]["yield"]["cells"]), {"card": [c["total"] for c in kw["rows"]["yield"]["cells"]], "engine": {e: [min(x["per"] for x in v), max(x["per"] for x in v)] if v else None for e, v in eng_tot.items()}})
    e0 = nth(walk[cid]["places"], 0)
    typed(f'#ycCard [data-yk="y|{e0}"]', "0.9"); wait(400)
    kw2 = card(); e2 = js("return perIn(%s, %s);" % (json.dumps(cid), json.dumps(e0)))
    cell = [c for c in kw2["rows"]["yield"]["cells"] if c["place"] == e0]
    check("a week's figure typed there moves the total beside it, and still to the engine's", len(cell) == 1 and len(e2) > 0 and all(abs(x["week"] - 0.9) < 1e-9 for x in e2) and abs(float(nth(cell, 0)["total"]["lo"]) - min(x["per"] for x in e2)) < 1e-9 and abs(float(nth(cell, 0)["total"]["hi"]) - max(x["per"] for x in e2)) < 1e-9, {"card": nth(cell, 0)["total"]})
    shot("card-gradually")
    undo_to(0)
    check("undone, the plan is what it was", snap()["key"] == snap0["key"])

    # ── cleared at once, and sold by the head: so many of every ten ──
    cid = sub["head"]; open_crop(cid)
    if has('#ycCard [data-yk="pick"]'): page.select_option('#ycCard [data-yk="pick"]', "once"); wait(600)
    if asking(): answer(True)
    ko = card(); e0 = nth(walk[cid]["places"], 0); y0 = walk[cid]["cells"][e0]["value"]; y0 = y0 if isinstance(y0, (int, float)) else 0
    check("a crop cleared at once and sold by the head asks how many of every 10 planted are fit to sell, and shows its figure so", ko["rows"]["yield"]["label"] == "Of every 10 planted, fit to sell" and (ko["boxes"][f"y|{e0}"]["value"] or ko["boxes"][f"y|{e0}"]["placeholder"]) == js("return fig(%s);" % (y0 * 10)) and all("cleared in one day" in c["na"] for c in ko["rows"]["last"]["cells"]), {"label": ko["rows"]["yield"]["label"], "box": ko["boxes"].get(f"y|{e0}"), "last": ko["rows"]["last"]})
    n0 = snap()["undo"]
    typed(f'#ycCard [data-yk="y|{e0}"]', "8"); wait(300)
    t1 = last_step(); st = js("return (((S.plan.assumptions || {}).crops || {})[%s] || {})[%s];" % (json.dumps(cid), json.dumps(e0))); key_card = snap()["key"]
    undo_to(n0); click('[data-ah-way="list"]', 600)
    typed(f'#ahBody [data-hk="y|crops|{cid}|{e0}"]', "0.8"); wait(300)
    t2 = last_step(); key_list = snap()["key"]
    check("8 of every 10 typed there is 0.8 a plant on the list: the same step, the same plan", st == {"yield": 0.8} and t1["label"] == t2["label"] and key_card == key_list and t1["n"] == n0 + 1, {"stored": st, "card": t1, "list": t2})
    typed(f'#ahBody [data-hk="y|crops|{cid}|{e0}"]', ""); wait(200)
    click('[data-ah-way="card"]', 600); open_crop(cid)
    typed(f'#ycCard [data-yk="y|{e0}"]', "12"); wait(200)
    check("more than 10 of every 10 is not taken", js("return ((((S.plan.assumptions || {}).crops || {})[%s] || {})[%s] || {}).yield;" % (json.dumps(cid), json.dumps(e0))) != 1.2 and card()["boxes"][f"y|{e0}"]["value"] != "12", card()["boxes"].get(f"y|{e0}"))
    undo_to(0)
    check("undone, the plan is what it was", snap()["key"] == snap0["key"])

    # ── fast entry: Tab to the next empty box, Enter for “Looks right, next”, a letter for the unit ──
    cid = sub["both"]; open_crop(cid, 400)
    f0 = card()
    check("a crop opened from the checklist has the pointer for typing in its first empty box", f0["focus"] == "price" and f0["boxes"]["price"]["amber"] is True, f0["focus"])
    page.keyboard.type("4.5"); page.keyboard.press("Tab"); wait(500)
    f1 = card(); s1 = last_step(); y_first = "y|" + str(nth(walk[cid]["places"], 0))
    check("Tab takes what was typed and goes to the next box that is still empty", s1["n"] == 1 and "$4.5" in s1["label"] and f1["focus"] == y_first and f1["boxes"][y_first]["amber"] is True and f1["boxes"]["price"]["value"] == "4.5", {"focus": f1["focus"], "step": s1})
    page.keyboard.type("2"); wait(100)
    order_now = [i["id"] for i in side()["items"]]; expect_next = order_now[(order_now.index(cid) + 1) % len(order_now)] if cid in order_now else None
    said_next = card()["next"]
    page.keyboard.press("Enter"); wait(700)
    f2 = card(); s2 = js("return { steps: S.undo.map(u => u.label), looked: S.engine.sellRule(%s).looked, y: (((S.plan.assumptions || {}).crops || {})[%s] || {}) };" % (json.dumps(cid), json.dumps(cid)))
    check("Enter takes what was typed, ticks the crop as looked at for the year, and opens the next crop down", len(s2["steps"]) == 3 and s2["looked"] == year and s2["y"] == {nth(walk[cid]["places"], 0): {"yield": 2}} and "looked at for %s" % year in s2["steps"][-1] and f2["crop"] == expect_next and said_next["id"] == expect_next and names.get(expect_next, "?") in said_next["text"] and said_next["text"].startswith("Looks right. Next: "), {"steps": s2["steps"], "now": names.get(f2["crop"]), "want": names.get(expect_next), "button": said_next})
    amber_next = [yk for yk, b in walk[expect_next]["card"]["boxes"].items() if b["amber"]] if expect_next in walk else []
    check("and the pointer lands in that crop's first empty box", f2["focus"] == (amber_next[0] if amber_next else "price") and (not amber_next or f2["boxes"][f2["focus"]]["amber"] is True), {"focus": f2["focus"], "amber": amber_next})
    sd = side(); it = [i for i in sd["items"] if i["id"] == cid]
    check("the crop is ticked on the checklist, the bar counts it, and one fewer is left to set", len(it) == 1 and it[0]["done"] is True and it[0]["open"] is False and sd["looked"] == 1 and f"1 of {len(ids)}" in sd["prog"] and sd["left"] == nleft - 1 and sd["meter"] not in ("0%", "0", ""), {"item": it, "prog": sd["prog"], "left": sd["left"]})
    check("the checklist keeps its order while figures are typed: a crop does not jump when it is set", [i["id"] for i in sd["items"]] == ids, None)
    before_enter = snap(); bare_before = js("return unticked();"); cur = f2["crop"]
    page.keyboard.press("Enter"); wait(600)
    f3 = card(); s3 = last_step(); after_enter = snap()
    check("Enter with nothing typed is the tick alone: one step, and the plan differs by that tick and nothing else", s3["n"] == 4 and names.get(cur, "?") in s3["label"] and "looked at" in s3["label"] and isinstance(bare_before, str) and js("return unticked();") == bare_before and after_enter["plan"] != before_enter["plan"] and after_enter["sig"] == before_enter["sig"] and f3["crop"] != cur, {"step": s3})
    # a letter picks the unit
    cid2 = sub["single"]; open_crop(cid2, 400); unit0 = walk[cid2]["unit"] if isinstance(walk[cid2]["unit"], str) else "?"
    letter = "b" if not unit0.startswith("b") else "s"; want_unit = "bunch" if letter == "b" else "stem"
    if has('#ycCard [data-yk="price"]'): page.locator('#ycCard [data-yk="price"]').first.click()
    n_before = snap()["undo"]
    page.keyboard.press(letter); wait(500)
    u1 = last_step(); ku = card()
    check("a letter typed in a number box picks the unit it begins, in the list's own step, and is not typed into the box", u1["n"] == n_before + 1 and u1["label"] == f"{names[cid2]}: sold by the {want_unit}" and js("return S.engine.sellRule(%s).unit;" % json.dumps(cid2)) == want_unit and ku["boxes"]["unit"]["value"] == want_unit and ku["boxes"]["price"]["value"] == walk[cid2]["card"]["boxes"]["price"]["value"] and ku["focus"] == "price", {"step": u1, "focus": ku["focus"]})
    check("the card says that no figure was turned into the new unit, and the yield stands as typed", "No figure was turned into the new unit" in js("return txt('ycUnitNote');") and js("return S.engine.harvestFor(%s).cells[%s].value;" % (json.dumps(cid2), json.dumps(nth(walk[cid2]["places"], 0)))) == walk[cid2]["cells"][nth(walk[cid2]["places"], 0)]["value"], js("return txt('ycUnitNote');"))
    page.keyboard.press(unit0[0]); wait(500)
    for _ in range(3):   # a letter pressed again goes on to the next unit that begins with it
        if js("return S.engine.harvestFor(%s).unit.value;" % json.dumps(cid2)) == unit0: break
        page.keyboard.press(unit0[0]); wait(400)
    check("the crop's own unit is picked the same way, and the plan is then what it was before the letter", js("return S.engine.sellRule(%s).unit;" % json.dumps(cid2)) is None or not js("return S.engine.sellRule(%s).unit;" % json.dumps(cid2)), js("return S.engine.harvestFor(%s).unit;" % json.dumps(cid2)))
    if has('#ycCard [data-yk="price"]'): page.locator('#ycCard [data-yk="price"]').first.click()
    page.keyboard.press("Tab"); wait(250)
    check("with no empty box left on a card, Tab goes on to the next box as it always does", card()["focus"] == "y|" + str(nth(walk[cid2]["places"], 0)), card()["focus"])
    shot("card-ticked")

    # ── ticks: the button, taking one off, and what they leave in the plan ──
    undo_to(0); wait(200)
    base = snap()
    check("undone, the plan is what it was", base["key"] == snap0["key"] and base["plan"] == snap0["plan"])
    open_crop(nth(ids, nleft + 1)); click("#ycNext", 500); t_a = card()
    click("#ycNext", 500); click("#ycNext", 500)
    sd = side(); st3 = snap()
    done_ids = [i["id"] for i in sd["items"] if i["done"]]
    check("“Looks right. Next: …” ticks the crop on the card and opens the next that is not yet ticked", len(done_ids) == 3 and done_ids == ids[nleft + 1:nleft + 4] and t_a["crop"] == nth(ids, nleft + 2) and card()["crop"] == nth(ids, nleft + 4) and sd["looked"] == 3 and st3["undo"] == 3, {"done": [names.get(x) for x in done_ids], "undo": st3["undo"]})
    check("only opened, walked and ticked, the plan differs by the ticks and by nothing else: no figure of any planting, and not the season's worth", js("return unticked();") == snap0["plan"] and st3["sig"] == snap0["sig"] and abs(st3["worth"] - snap0["worth"]) < 1e-6 and st3["key"] != snap0["key"], {"worth": [snap0["worth"], st3["worth"]]})
    stored = js("return (S.plan.assumptions || {}).sell || {};")
    check("a tick is the year, kept on the crop's line of the list", stored == {i: {"looked": year} for i in ids[nleft + 1:nleft + 4]}, stored)
    open_crop(nth(ids, nleft + 2)); kd = card()
    check("a ticked crop's card says it is looked at for the year, and offers to take the tick off", f"Looked at for {year}" in kd["state"] and kd["untick"] is True, kd["state"])
    click("#ycUntick", 500); sd2 = side()
    check("the tick taken off is one step, and the bar counts one fewer", snap()["undo"] == 4 and sd2["looked"] == 2 and nth([i for i in sd2["items"] if i["id"] == nth(ids, nleft + 2)], 0)["done"] is False and f"Not looked at for {year}" in card()["state"], sd2["prog"])
    undo_to(0)
    check("undone, the plan is what it was", snap()["key"] == snap0["key"])

    # ── what the house keeps ──
    cid = sub["under"]; open_crop(cid); kh = card(); share = walk[cid]["share"]
    said = js("const hc = S.engine.harvestFor(%s); return { house: hc.house, share: hc.share };" % json.dumps(cid))
    check("a crop that sells less than all of it today is shown as partly kept, with no mark on it: no figure had to change for that", said["house"]["part"] is True and said["house"]["marked"] is False and said["house"]["sold"] == share and "counts as sold today" in kh["house"]["why"] and snap()["key"] == snap0["key"], said)
    click("#ycSoldAll", 500)
    ask = asking()
    full = js("const a = JSON.parse(JSON.stringify(S.plan.assumptions || { v: 1, crops: {}, varieties: {} })); a.sell = a.sell || {}; a.sell[%s] = { ...(a.sell[%s] || {}), share: 100 }; const e2 = E.create({ ...S.plan, assumptions: a }, LRFLibrary); return { was: money(worthOf(S.engine)), now: money(worthOf(e2)), moved: Math.abs(worthOf(e2) - worthOf(S.engine)) >= 0.5 };" % (json.dumps(cid), json.dumps(cid)))
    check("“Sold in full…” first shows what that does to the season's worth: from what it is to what an engine with all of the crop sold makes it", bool(ask) and "sold in full" in ask["title"] and full["moved"] is True and full["was"] in ask["text"] and full["now"] in ask["text"] and f"{js('return fig(%s);' % share)}%" in ask["text"] and snap()["key"] == snap0["key"], {"window": ask, "worth": full})
    answer(False)
    check("turned down, nothing is changed", snap()["key"] == snap0["key"] and snap()["undo"] == 0 and not asking())
    click("#ycSoldAll", 500); answer(True, 700)
    sold = js("const hc = S.engine.harvestFor(%s); return { rule: S.engine.sellRule(%s).share, house: hc.house, worth: money(worthOf(S.engine)), undo: S.undo.length, label: (S.undo[S.undo.length - 1] || {}).label, toast: txt('toast') };" % (json.dumps(cid), json.dumps(cid)))
    check("agreed, it is one step: all of the crop counts as sold, the season is worth what the window said, and the house's line is gone from the card", sold["rule"] == 100 and sold["house"]["part"] is False and sold["worth"] == full["now"] and sold["undo"] == 1 and "sold in full" in sold["label"] and not card()["house"] and full["now"] in sold["toast"], sold)
    dates = [l.rsplit("|", 3)[0] for l in snap()["sig"].split("\n")]
    check("and no date of any planting moved with it", dates == [l.rsplit("|", 3)[0] for l in snap0["sig"].split("\n")])
    # the mark, on the crop's record
    page.evaluate("LRFApp.setView('seeds')"); wait(900)
    click("[data-sd-tab=crops]", 500)
    page.evaluate("id => { const row = document.querySelector(`#seedsView [data-croprow=\"${CSS.escape(id)}\"]`); if (row) row.click(); }", cid); wait(600)
    sh = js("const el = $('sdHouse'); return el ? { seen: seen(el), text: el.innerText, pressed: [...el.querySelectorAll('.seg button')].map(b => [b.dataset.house, b.textContent, b.getAttribute('aria-pressed')]) } : null;")
    check("Seeds, a crop's record: “Grown for” is “For sale” or “For sale and the house”, and says which the crop is", bool(sh) and sh["seen"] is True and sh["pressed"] == [["sale", "For sale", "true"], ["part", "For sale and the house", "false"]], sh)
    before = snap()
    click('#sdHouse [data-house="part"]', 500)
    mk = js("const hc = S.engine.harvestFor(%s); return { stored: ((S.plan.assumptions || {}).sell || {})[%s], house: hc.house, undo: S.undo.length, label: (S.undo[S.undo.length - 1] || {}).label, asked: !!document.querySelector('dialog[open]'), pressed: [...document.querySelectorAll('#sdHouse .seg button')].map(b => b.getAttribute('aria-pressed')), toast: txt('toast') };" % (json.dumps(cid), json.dumps(cid)))
    after = snap()
    check("“For sale and the house” marks the crop, on its own line of the plan, in one step, without asking", mk["stored"] == {"share": 100, "house": True} and mk["house"]["marked"] is True and mk["house"]["part"] is True and mk["undo"] == before["undo"] + 1 and "for sale and the house" in mk["label"] and mk["asked"] is False and mk["pressed"] == ["false", "true"], mk)
    check("and the mark changes no figure: every planting gives what it gave, and the season is worth what it was", after["sig"] == before["sig"] and abs(after["worth"] - before["worth"]) < 1e-9 and "no figure changes" in mk["toast"], {"worth": [before["worth"], after["worth"]]})
    page.evaluate("LRFApp.setView('assume')"); wait(400)
    click('[data-as-mode="harvest"]', 400); click('[data-ah-way="card"]', 400); open_crop(cid, 400)
    km = card()
    check("its card then has the house's line, the box amber and empty, and says the crop is marked so on its record", bool(km["house"]) and km["boxes"]["house"]["amber"] is True and km["boxes"]["house"]["value"] == "" and "marked" in km["house"]["why"] and any("house keeps" in t for t in km["waits"]), km["house"])
    typed('#ycCard [data-yk="house"]', "15"); wait(400)
    hs = last_step(); kh2 = card()
    check("what the house keeps, typed there, is the list's sold share: 15 kept is 85 sold, in the list's own words", js("return S.engine.sellRule(%s).share;" % json.dumps(cid)) == 85 and hs["label"] == f"{names[cid]}: 85% sold" and kh2["boxes"]["house"]["value"] == "15" and kh2["boxes"]["house"]["mine"] is True, hs)
    check("a sold share typed by the grower is listed under the checklist, as typed", f"{names[cid]} 85%" in js("return txt('ycTyped');") and "Sold shares you typed" in js("return txt('ycTyped');"), js("return txt('ycTyped');"))
    click('[data-ah-way="list"]', 500)
    check("and the list shows it as 85 in “Sold %”", js("return (document.querySelector('#ahBody [data-hk=\"share|%s\"]') || {}).value;" % cid) == "85")
    click('[data-ah-way="card"]', 500)

    # ── the farm's own switch ──
    sw0 = js("return { on: $('ahHouseOn').checked, seen: seen($('ahHouseFarm')), text: $('ahHouseFarm').innerText.trim() };")
    check("one switch for the farm stands on the page, on while the farm keeps part of some crops", sw0 == {"on": True, "seen": True, "text": "The house keeps part of some crops"}, sw0)
    before = snap()
    click("#ahHouseOn", 500); ask = asking()
    allsold = js("const a = JSON.parse(JSON.stringify(S.plan.assumptions || { v: 1, crops: {}, varieties: {} })); a.sell = a.sell || {}; for (const c of S.engine.crops()) a.sell[c.id] = { ...(a.sell[c.id] || {}), share: 100 }; const e2 = E.create({ ...S.plan, assumptions: a }, LRFLibrary); return { was: money(worthOf(S.engine)), now: money(worthOf(e2)), n: worthOf(e2) };")
    check("turned off, it first shows the season's worth with every crop sold in full, worked out here crop by crop", bool(ask) and allsold["was"] in ask["text"] and allsold["now"] in ask["text"] and allsold["was"] != allsold["now"] and snap()["key"] == before["key"], {"window": ask, "worth": allsold})
    answer(False); wait(300)
    check("turned down, the switch is as it was and nothing is changed", js("return $('ahHouseOn').checked;") is True and snap()["key"] == before["key"] and snap()["undo"] == before["undo"])
    click("#ahHouseOn", 500); answer(True, 800)
    off = js("return { setting: S.plan.settings.houseKeeps, undo: S.undo.length, worth: worthOf(S.engine), on: $('ahHouseOn').checked, kinds: S.undo[S.undo.length - 1].ops.map(o => o.kind), sell: JSON.stringify((S.plan.assumptions || {}).sell || {}) };")
    check("agreed, it is one step in the farm's settings: every crop counts as sold in full, and each crop's own share is kept for the day it is turned on again", off["setting"] is False and off["undo"] == before["undo"] + 1 and abs(off["worth"] - allsold["n"]) < 1e-6 and off["on"] is False and off["kinds"] == ["settings"] and off["sell"] == js("return JSON.stringify((JSON.parse(%s).assumptions || {}).sell || {});" % json.dumps(before["plan"])), off)
    lines = []
    for c in [sub["under"], sub["multi"], sub["single"], sub["ft"]]:
        open_crop(c, 120); lines.append(bool(card()["house"]))
    click('[data-ah-way="list"]', 500)
    hid = js("return { head: [...document.querySelectorAll('#ahHead th')].filter(th => seen(th)).map(th => th.textContent), cells: [...document.querySelectorAll('#ahBody tr.as-crop')].every(r => r.children.length === 13), box: [...document.querySelectorAll('#ahBody [data-hk^=\"share|\"]')].filter(seen).length };")
    page.evaluate("LRFApp.setView('seeds')"); wait(700)
    sdh = js("const el = $('sdHouse'); return el ? { farm: el.dataset.farm, buttons: el.querySelectorAll('button').length, text: el.innerText } : null;")
    check("with it off the house is shown on no page: no line on any card, no “Sold %” on the list, nothing to choose on a crop's record", lines == [False, False, False, False] and "Sold %" not in hid["head"] and hid["box"] == 0 and hid["cells"] is True and bool(sdh) and sdh["farm"] == "off" and sdh["buttons"] == 0, {"cards": lines, "list": hid, "seeds": sdh})
    page.evaluate("LRFApp.setView('assume')"); wait(400); click('[data-as-mode="harvest"]', 300); click('[data-ah-way="card"]', 500)
    # the three things this build adds to a plan travel with it: in the file Backup downloads, in a snapshot, and back from each
    open_crop(sub["multi"], 200); click("#ycNext", 400)
    held = js("return { sell: (S.plan.assumptions || {}).sell || {}, farm: S.plan.settings.houseKeeps, key: A.contentKey(), n: S.plan.plantings.length };")
    data = {}
    try:
        with page.expect_download(timeout=20000) as dl:
            page.click("#dataBtn"); page.click("#exportBtn")
        saved = os.path.join(str(shots), "plan-with-marks.json"); dl.value.save_as(saved)
        data = json.load(open(saved, encoding="utf-8"))
    except Exception as e:
        errors.append("download: " + str(e)[:160])
    sell = (data.get("assumptions") or {}).get("sell") or {}
    check("the tick, the mark for the house and the farm's switch are in the file “Download a backup” writes", bool(held["sell"]) and sell == held["sell"] and (data.get("settings") or {}).get("houseKeeps") is False and (sell.get(sub["multi"]) or {}).get("looked") == year and (sell.get(sub["under"]) or {}).get("house") is True, {"file": sell, "held": held})
    kept = page.evaluate("(async () => { const A = LRFApp; if (!A.snapshotsKept()) return null; const row = await A.snapshot('with the marks'); return row ? { id: row.id, name: row.name } : null; })()")
    page.evaluate("(() => { const A = LRFApp; while (A.state.undo.length) A.undo(); })()"); wait(600)
    bare = snap()
    check("with every step undone the plan is what it was when the check began: nothing of the three is left in it", bare["key"] == snap0["key"] and bare["plan"] == snap0["plan"] and bare["sig"] == snap0["sig"], {"undo": bare["undo"]})
    if kept:
        page.evaluate("id => LRFApp.snapshots().then(s => { const row = s.rows.find(r => r.id === id); return row ? LRFApp.restoreSnapshot(row, { asked: true }) : false; })", kept["id"]); wait(1500)
    back = js("return { sell: (S.plan.assumptions || {}).sell || {}, farm: S.plan.settings.houseKeeps, n: S.plan.plantings.length };")
    check("a snapshot holds them, and going back to it brings them back", bool(kept) and back["sell"] == held["sell"] and back["farm"] is False and back["n"] == held["n"], {"kept": kept, "back": back})
    page.evaluate("LRFApp.setView('assume')"); wait(400); click('[data-as-mode="harvest"]', 300); click('[data-ah-way="card"]', 500)
    sd = side()
    check("and the page shows them again: the tick on the checklist, the switch off", sd["looked"] == 1 and [i["id"] for i in sd["items"] if i["done"]] == [sub["multi"]] and js("return $('ahHouseOn').checked;") is False, sd["prog"])
    click("#ahHouseOn", 500); ask_on = asking(); answer(True, 800)
    on = js("return { keys: Object.keys(S.plan.settings), on: $('ahHouseOn').checked, sold: S.engine.harvestFor(%s).house.sold };" % json.dumps(sub["under"]))
    check("turned on again it asks the same way, and each crop's own share counts as before", bool(ask_on) and "house" in ask_on["title"].lower() and "houseKeeps" not in on["keys"] and on["on"] is True and on["sold"] == 85, {"window": ask_on, "now": on})

    # ── a plan made before this build reads as it did ──
    old = js("""const p = JSON.parse(JSON.stringify(S.plan)); if (p.assumptions && p.assumptions.sell) for (const id of Object.keys(p.assumptions.sell)) { delete p.assumptions.sell[id].looked; delete p.assumptions.sell[id].house; }
      delete p.settings.houseKeeps; const e = E.create(p, LRFLibrary), crops = e.crops();
      return { marked: crops.filter(c => e.harvestFor(c.id).house.marked || e.harvestFor(c.id).looked != null || !e.harvestFor(c.id).house.farm).length, shares: crops.filter(c => !c.micro).every(c => { const hc = e.harvestFor(c.id); return hc.house.part === (hc.share.value < 100) && hc.house.sold === hc.share.value; }), n: crops.length };""")
    check("a plan with none of the three in it reads as it always did: nothing marked, nothing looked at, each crop sold at its own share", old["marked"] == 0 and old["shares"] is True and old["n"] > 20, old)
    check("no error was written to the console", errors == [], errors[:4])
    browser.close()
finish()
