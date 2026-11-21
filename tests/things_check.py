"""More than one thing sold from a crop, in a real browser: the three kinds (a different thing from one place, two things out
of one bed, one harvest packed two ways), each added, filled, changed and taken away on the card; what each change says of the
season's worth before it is made, against what the forecast then shows; and the forecast, the Harvest page, the list to send,
the spreadsheet, "plan to a weekly amount" and "All on one page", each thing in its own unit. An untouched plan is held against
the build before's own scripts, run in the same page. It finds its subjects on the plan it is given.
usage: python3 -I things_check.py <app-dir-or-built-site> <shots-dir> <dir of the build before> <backup.zip>     env: WIDTH=1480, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, re, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots, before, backup = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]; shots.mkdir(parents=True, exist_ok=True)
WIDTH = int(os.environ.get("WIDTH", "1280")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors, asked = [], [], [], []
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok:
        failed.append(name)
        if STOP: finish()
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
def old_scripts():
    """The build before's engine and forecast, as text: run inside the page, beside this build's, on the same plan."""
    try: return [[n, (before / "js" / n).read_text(encoding="utf-8")] for n in ("sowing.js", "engine.js", "forecast.js")]
    except Exception as e:
        errors.append("the build before: " + str(e)[:160]); return []
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, $ = id => document.getElementById(id), txt = id => ($(id) || {}).textContent || '';"
       "const money = n => '$' + Math.round(n).toLocaleString('en-US'), near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));"
       "const fig = n => n == null || !Number.isFinite(+n) ? '' : String(+(+n).toFixed(Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : Math.abs(n) >= 0.1 ? 2 : 3));"
       "const seen = el => !!el && el.offsetParent !== null;"
       # a forecast, whole, as one line of text: every row, its totals, and every day of what is picked, sold and worth
       "const hash = s => { let a = 0xdeadbeef, b = 0x41c6ce57; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); } return (a >>> 0).toString(16) + (b >>> 0).toString(16) + ':' + s.length; };"
       "const whole = m => hash(m.rows.map(r => [r.key, r.name, r.unit, r.group, r.total, r.worth, r.pickedTotal, r.plantings.length, r.unset, Array.from(r.days).join(','), Array.from(r.picked).join(','), Array.from(r.value).join(',')].join('|')).join('\\n') + '\\n' + [m.counted, m.unset.length, m.personal, m.keeps].join('|'));"
       "const worthOf = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);"
       # held to the build before, the plantings the first fall frost cuts (E2c) are held at the last day they were to be picked, by a
       # day of their own: the build before knows that way and no other (tests/frost_held.cjs). A build before that knows the rule is not held.
       "const heldPlan = (plan, old) => { if (old && typeof old.seasonEndOf === 'function') return plan; const e = E.create(plan, LRFLibrary), cut = new Set(plan.plantings.filter(p => { const r = e.calc(p); return r && r.frostCut; }).map(p => p.id)); return cut.size ? { ...plan, plantings: plan.plantings.map(p => cut.has(p.id) ? { ...p, harvestEnd: E.d2s(e.calc(p).frostCut.planned) } : p) } : plan; };"
       "const heldEngine = (plan, old) => E.create(heldPlan(plan, old), LRFLibrary);"
       # and the plantings bought in (N2) are left out on both sides when the build before sows them (tests/bought_held.cjs)
       "const boughtOut = (plan, old) => { if (old && typeof old.startedFrom === 'function') return plan; const e = E.create(plan, LRFLibrary), ids = new Set(plan.plantings.filter(p => { const r = e.calc(p); return r && r.boughtIn; }).map(p => p.id)); return ids.size ? { ...plan, plantings: plan.plantings.filter(p => !ids.has(p.id)) } : plan; };"
       # every planting's days and the ground it holds: what "a thing moves no date" means
       "const dates = () => hash(S.plan.plantings.map(p => { const r = S.engine.calc(p); return r ? [p.id, +r.first, +r.last, +(r.sow || 0), +r.field, +S.engine.occupancyThrough(p, r), r.plants, r.seeds, r.trays].join('|') : p.id; }).join('\\n'));"
       "const snap = () => { const m = F.build(S.engine); return { key: A.contentKey(), undo: S.undo.length, plan: JSON.stringify({ ...S.plan, lrfNext: null }), whole: whole(m), dates: dates(), worth: m.rows.reduce((n, r) => n + r.worth, 0), rows: m.rows.length }; };"
       "const follows = p => { const e = S.engine, r = e.calc(p), y = r ? e.yieldOf(p, r) : null, v = e.variety(p.varietyId); return !!y && !y.own && y.set && y.units > 0 && !(r.rack && r.c.micro) && !(v && v.cropId === p.cropId && e.sellVRule(v.id).unit) && r.b.active !== false && r.g.active !== false; };"
       "const things = id => S.engine.thingsOf(id).map(t => ({ id: t.id, name: t.name, from: t.from, place: t.place, unit: t.unit, price: t.price, share: t.share, yield: t.yield, counted: t.counted, weighs: t.weighs, holds: t.holds, of: t.of, pattern: t.pattern, days: t.days, waits: t.waits, counts: t.counts, why: t.why, way: t.way }));"
       "const rowsOf = id => F.build(S.engine).rows.filter(r => r.cropId === id).map(r => ({ key: r.key, name: r.name, unit: r.unit, group: r.group, thing: r.thing || '', total: r.total, worth: r.worth, n: r.plantings.length }));"
       "const record = id => JSON.stringify((((S.plan.assumptions || {}).sell || {})[id] || {}).things || {});"
       # the card on show: its columns, its rows, its boxes
       "const card = () => { const c = $('ycCard'); if (!seen(c) || !$('ycGrid')) return null;"
       " const heads = [...c.querySelectorAll('#ycGrid thead th')].slice(1).map(th => ({ place: th.dataset.place || null, thing: th.dataset.thing || null, counts: th.dataset.counts || null, text: th.innerText.replace(/\\s+/g, ' ').trim() }));"
       " const rows = {}; for (const tr of c.querySelectorAll('#ycGrid tbody tr')) rows[tr.dataset.row] = { label: tr.querySelector('th b').textContent, hint: (tr.querySelector('th small') || {}).textContent || '', own: [...tr.querySelectorAll('td:not(.yc-thing)')].map(td => td.innerText.replace(/\\s+/g, ' ').trim()).join(' / '), things: Object.fromEntries([...tr.querySelectorAll('td.yc-thing')].map(td => [td.dataset.thing, td.innerText.replace(/\\s+/g, ' ').trim()])) };"
       " const boxes = {}; for (const el of c.querySelectorAll('[data-yk]')) boxes[el.dataset.yk] = { value: el.value, amber: !!el.closest('.yc-box.amber'), label: el.getAttribute('aria-label') || '' };"
       " return { crop: c.dataset.crop, heads, order: Object.keys(rows), rows, boxes, add: seen($('ycAdd')), still: txt('ycStill'), comes: [...c.querySelectorAll('#ycComes p[data-unit]')].map(p => ({ unit: p.dataset.unit, thing: p.dataset.thing || '', total: +p.dataset.total, worth: +p.dataset.worth, text: p.textContent })), waits: [...c.querySelectorAll('#ycWaits li')].map(li => li.textContent), left: Object.fromEntries([...c.querySelectorAll('[data-left]')].map(b => [b.closest('tr').dataset.row, +b.dataset.left])) }; };"
       "const toast = () => { const t = [...document.querySelectorAll('.toast')].pop(); return t ? t.innerText.replace(/\\s+/g, ' ') : ''; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="light", accept_downloads=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    def load_backup():
        page.evaluate("window.__was = LRFApp.state.plan")   # the plan in hand: the load is done when another has taken its place
        page.set_input_files("#importFile", backup)
        yes = "dialog[open] .dialog-actions .btn.danger, dialog[open] .dialog-actions .btn.primary"   # “Replace plan”
        try: page.wait_for_selector(yes, timeout=8000); asked.append(page.locator("dialog[open]").inner_text()); page.locator(yes).first.click()
        except Exception: pass   # a browser with no plan of its own is not asked
        try: page.wait_for_function("LRFApp.state.plan !== window.__was && LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000)
        except Exception as e: errors.append("the backup did not load: " + str(e)[:120])
        page.wait_for_timeout(1500)
    if page.evaluate("LRFApp.isSample()"): load_backup()
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
        __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = __truediv__ = __rtruediv__ = __add__
        def __abs__(self): return 0
        def __float__(self): return float("nan")
        def __round__(self, n=None): return -1
        def startswith(self, x): return False
        def endswith(self, x): return False
        def split(self, *a): return []
        def lower(self): return ""
        def values(self): return []
        def items(self): return []
        def keys(self): return []
        def __str__(self): return "(not there)"
    def soft(v):
        if v is None: return Missing()
        if isinstance(v, dict): return type("Soft", (dict,), {"__getitem__": lambda s, k: dict.get(s, k, Missing()), "get": lambda s, k, d=None: dict.get(s, k, Missing() if d is None else d)})({k: soft(x) for k, x in v.items()})
        if isinstance(v, list): return [soft(x) for x in v]
        return v
    def nth(seq, i): return seq[i] if isinstance(seq, list) and -len(seq) <= i < len(seq) else Missing()
    def pos(seq, x): return seq.index(x) if isinstance(seq, list) and x in seq else -9   # where a row stands among the card's rows; -9 when it is not there
    def val(v): return None if isinstance(v, Missing) or v in ("", None) else float(v)
    def js(body, arg=None):
        try: return soft(page.evaluate("(arg) => { " + PRE + " " + body + " }", arg))
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
    def snap(): return js("return snap();")
    def asking(): return js("const d = document.querySelector('dialog[open]'); return d ? { title: (d.querySelector('h2') || {}).textContent || '', text: d.innerText.replace(/\\s+/g, ' '), id: d.id } : null;")
    def answer(yes, ms=600): return click("dialog[open] .btn.primary" if yes else "dialog[open] .dialog-actions .btn:not(.primary)", ms)
    def typed(sel, text, key="Tab", ms=500):
        if not has(sel): wait(100); return False
        try: page.locator(sel).first.click(timeout=4000)
        except Exception: return False
        page.keyboard.press("Control+a")
        if text == "": page.keyboard.press("Delete")
        else: page.keyboard.type(text)
        if key: page.keyboard.press(key)
        wait(ms); return True
    def last_step(): return js("const u = S.undo[S.undo.length - 1]; return u ? { label: u.label, n: S.undo.length, kinds: u.ops.map(o => o.kind || 'planting') } : { label: '', n: 0, kinds: [] };")
    def undo(ms=350): js("A.undo(); return 1;"); wait(ms)
    def undo_to(n, ms=200):
        for _ in range(80):
            k = js("return S.undo.length;")
            if not isinstance(k, int) or k <= n: break
            undo(ms)
    def said(text):
        """The season's worth a window or a message speaks of: (before, after) in dollars as written, or None."""
        text = str(text or ""); m = re.search(r"goes from \$([\d,]+) to \$([\d,]+)", text)
        if m: return (m.group(1), m.group(2))
        m = re.search(r"worth stays \$([\d,]+)", text)
        return (m.group(1), m.group(1)) if m else None
    def dollars(n): return "{:,}".format(int(round(n))) if isinstance(n, (int, float)) else "?"
    def card_page():
        page.evaluate("LRFApp.setView('assume')"); wait(400); click('[data-as-mode="harvest"]', 500)
        if not has("#ycCard"): click('[data-ah-way="card"]', 500)
    def open_crop(cid, ms=300):
        ok = click(f'#ycList .yc-item[data-crop="{cid}"]', ms); js("document.querySelector('.view-assume').scrollTop = 0; return 1;"); return ok
    def add(cid, name, unit, kind, place=None):
        """Add a thing as a hand does: the button, the window, its name, its unit, its kind. Returns what the window said and the new id."""
        open_crop(cid); click("#ycAdd", 400); window = asking()
        typed("#thName", name, key=None, ms=100)
        if has("#thUnit"): page.select_option("#thUnit", unit)
        click(f'input[name="thFrom"][value="{kind}"]', 100)
        if place and has("#thPlace"): page.select_option("#thPlace", place)
        click("#thGo", 700)
        return window, js("const t = S.engine.thingsOf(arg[0]).find(t => t.name === arg[1]); return t ? t.id : null;", [cid, name])
    def box(tid, what): return f'[data-yk="t|{tid}|{what}"]'
    def focus():
        """Where the pointer for typing is: a box's key, a button's id, or "window: Apply" for a button of a window that asks."""
        return js("const a = document.activeElement; if (!a) return ''; const d = a.closest('dialog[open]'); return d ? 'window: ' + a.textContent : (a.dataset && a.dataset.yk) || a.id || a.tagName;")
    def differs(text, a, b):
        """Does a window or a message give the difference between two worths in words: "$125 less", "$87 more"?"""
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and (": $%s %s" % (dollars(abs(b - a)), "more" if b > a else "less")) in str(text or "")
    def fill(tid, what, value, yes=True):
        """Type one figure of a thing. Returns the window it asked with, if it asked; answered as told."""
        typed(box(tid, what), str(value)); window = asking()
        if window: answer(yes)
        return window

    # ── the build before, in the same page, on the same plan ──
    start = js("""const mods = {}, req = n => mods[n.replace('./', '')];
      for (const [name, src] of arg) { const module = { exports: {} }; new Function('module', 'exports', 'require', src)(module, module.exports, req); mods[name] = module.exports; }
      window.__before = mods;
      const E0 = mods['engine.js'], F0 = mods['forecast.js'], plan = E0 ? boughtOut(S.plan, E0.create(S.plan, LRFLibrary)) : S.plan, old = E0 && F0 ? E0.create(plan, LRFLibrary) : null, m0 = old ? F0.build(old) : null, now = heldEngine(plan, old), m1 = F.build(now);
      const use = u => old ? whole(F0.build(old, { use: u })) === whole(F.build(now, { use: u })) : false;
      const days = e => hash(plan.plantings.map(p0 => { const p = e.planting(p0.id) || p0, r = e.calc(p), y = r ? e.yieldOf(p, r) : null; return r ? [p.id, +r.first, +r.last, +(r.sow || 0), +r.field, +e.occupancyThrough(p, r), r.plants, r.seeds, r.trays, y ? y.units : '', y ? y.unit : '', y ? y.price : ''].join('|') : p.id; }).join('\\n'));
      return { n: plan.plantings.length, sample: A.isSample(), year: A.planYear(), label: txt('buildNote'), had: !!m0, same: !!m0 && whole(m0) === whole(m1), rows: [m0 ? m0.rows.length : -1, m1.rows.length], worth: [m0 ? m0.rows.reduce((n, r) => n + r.worth, 0) : -1, m1.rows.reduce((n, r) => n + r.worth, 0)],
        uses: use('commercial') && use('personal'), days: !!old && days(old) === days(now), bench: !!old && JSON.stringify(old.benchDay(S.date)) === JSON.stringify(E.create(plan, LRFLibrary).benchDay(S.date)),
        none: S.engine.crops().every(c => S.engine.thingsOf(c.id).length === 0) && plan.plantings.every(p => S.engine.soldOf(p) === null) && !JSON.stringify(plan.assumptions || null).includes('things') };""", old_scripts())
    check("the farm is loaded and nobody has touched it: no crop sells a second thing", start["n"] > 600 and start["sample"] is False and start["none"] is True, start)
    check("an untouched plan is forecast exactly as the build before forecasts it, its scripts run in this page on this plan: every row, every total, every day of what is picked, sold and worth", start["had"] is True and start["same"] is True and start["rows"][0] == start["rows"][1] and start["worth"][0] == start["worth"][1] and start["worth"][1] > 1000, {k: start[k] for k in ("had", "same", "rows", "worth")})
    check("and so is what is grown to sell alone and what is for personal use alone; every planting has the build before's days, ground, plants, seeds, trays, yield and price, and the benches hold what they held", start["uses"] is True and start["days"] is True and start["bench"] is True, {k: start[k] for k in ("uses", "days", "bench")})
    year = start["year"]; snap0 = snap()

    # ── subjects, found on the plan ──
    sub = js("""const e = S.engine, base = F.build(e), info = new Map();
      for (const p of S.plan.plantings) { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null, x = info.get(p.cropId) || { id: p.cropId, n: 0, envs: {}, own: 0, least: Infinity, soil: true }; info.set(p.cropId, x);
        if (y && y.own && !(r.rack && r.c.micro)) x.own++;
        if (!follows(p)) continue; x.n++; x.envs[e.envOf(r.b)] = (x.envs[e.envOf(r.b)] || 0) + 1; x.least = Math.min(x.least, r.harvestDays); if (!e.isSoilBed(r.b)) x.soil = false; }
      const usable = [...info.values()].filter(x => x.n > 0).filter(x => { const c = e.crop(x.id), hc = e.harvestFor(x.id); return c && !c.micro && !e.isCoverCrop(c) && hc.price.value > 0 && base.rows.some(r => r.cropId === x.id && r.total > 0); }).sort((a, b) => b.n - a.n);
      const loose = id => { const hc = e.harvestFor(id); return hc.open.yield && e.ENVS.every(env => hc.cells[env].mine == null); };
      const placed = usable.find(x => Object.keys(x.envs).length >= 2 && e.COUNTED.includes(e.unitOf(e.crop(x.id))) && x.n <= 40 && loose(x.id)) || usable.find(x => Object.keys(x.envs).length >= 2 && e.COUNTED.includes(e.unitOf(e.crop(x.id))) && x.n <= 40) || usable.find(x => Object.keys(x.envs).length >= 2 && e.COUNTED.includes(e.unitOf(e.crop(x.id))));
      const bedded = usable.find(x => Object.keys(x.envs).length === 1 && x.n >= 2 && x.soil && x.least >= 10 && x.own >= 1 && e.harvestFor(x.id).basis === 'ft' && !e.WEIGHED.includes(e.unitOf(e.crop(x.id))) && (!placed || x.id !== placed.id));
      const packed = usable.find(x => /^stems?$/.test(e.unitOf(e.crop(x.id))) && (!bedded || x.id !== bedded.id) && (!placed || x.id !== placed.id));
      const micro = e.crops().find(c => c.micro && S.plan.plantings.some(p => p.cropId === c.id));
      const name = id => id ? e.crop(id).name : null, unit = id => id ? e.unitOf(e.crop(id)) : null;
      // the place a thing takes: the one with fewest plantings that follow the line
      const place = placed ? Object.entries(placed.envs).sort((a, b) => a[1] - b[1])[0][0] : null;
      return { placed: placed ? placed.id : null, place, places: placed ? Object.keys(placed.envs) : [], bedded: bedded ? bedded.id : null, packed: packed ? packed.id : null, micro: micro ? micro.id : null,
        names: { placed: name(placed && placed.id), bedded: name(bedded && bedded.id), packed: name(packed && packed.id) }, units: { placed: unit(placed && placed.id), bedded: unit(bedded && bedded.id), packed: unit(packed && packed.id) } };""")
    check("the farm has a subject for each kind: a counted crop that follows its line in two places; a crop sown by the bed-foot in soil beds, picked for ten days or more, one of whose plantings carries a yield of its own; a flower sold by the stem; and a live tray", all(isinstance(sub[k], str) for k in ("placed", "place", "bedded", "packed", "micro")), sub)
    P, B, K = sub["placed"], sub["bedded"], sub["packed"]; nameP, nameB, nameK = sub["names"]["placed"], sub["names"]["bedded"], sub["names"]["packed"]

    # ── the card before anything is added ──
    card_page(); open_crop(B); c0 = card(); left0 = js("return +$('ycLeft').dataset.left;")
    open_crop(sub["micro"]); cm = js("return { add: !!$('ycAdd') };")
    open_crop(B)
    check("an untouched crop's card has no column for another thing, no share row and no helper row; it offers “Add something else you sell…”; a live tray's card does not", bool(c0) and c0["add"] is True and all(h["thing"] is None or not h["thing"] for h in c0["heads"]) and "sharebed" not in c0["order"] and "sharepack" not in c0["order"] and "helper" not in c0["order"] and cm["add"] is False, {"order": c0["order"], "heads": c0["heads"], "micro": cm})

    # ══ two things out of one bed ══
    click("#ycAdd", 400); w = asking(); kinds = js("return [...document.querySelectorAll('input[name=thFrom]')].map(i => ({ value: i.value, off: i.disabled, checked: i.checked, plain: (i.closest('label').querySelector('.th-plain') || {}).textContent || '' }));"); ask0 = js("$('thName').value = 'Anything'; $('thGo').click(); return { go: $('thGo').disabled, legend: (document.querySelector('.th-kinds legend') || {}).textContent, open: !!document.querySelector('dialog#thAdd[open]'), undo: S.undo.length };"); js("$('thName').value = ''; return 1;")
    check("the window that adds a thing says nothing is forecast from it until its boxes are filled, and gives the season's worth as it stays: the forecast's own figure", bool(w) and w["id"] == "thAdd" and "Nothing is forecast from it until its boxes are filled" in w["text"] and said(w["text"]) == (dollars(snap0["worth"]), dollars(snap0["worth"])), w)
    check("it asks “Which is it?” and offers the three kinds; “a different thing from one place” is not offered for a crop planted in one kind of place", [k["value"] for k in kinds] == ["bed", "harvest", "place"] and nth(kinds, 2)["off"] is True and nth(kinds, 0)["off"] is False and nth(kinds, 1)["off"] is False and ask0["legend"] == "Which is it?", [kinds, ask0])
    check("no kind is chosen for him: none is ticked, “Add it” cannot be pressed and adds nothing until one is, and each kind carries one plain line that tells it from the others", all(k["checked"] is False for k in kinds) and len(kinds) == 3 and ask0["go"] is True and ask0["open"] is True and ask0["undo"] == 0 and "different times out of one bed" in nth(kinds, 0)["plain"] and "same picking, packed two ways" in nth(kinds, 1)["plain"] and "one growing place" in nth(kinds, 2)["plain"], [kinds, ask0])
    click('input[name="thFrom"][value="bed"]', 150); go1 = js("return $('thGo').disabled;")
    click("#thGo", 300); no_name = js("return { open: !!document.querySelector('dialog#thAdd[open]'), said: txt('thSaid'), undo: S.undo.length };")
    typed("#thName", nameB, key=None, ms=100); click("#thGo", 300); same_name = js("return { open: !!document.querySelector('dialog#thAdd[open]'), said: txt('thSaid'), undo: S.undo.length };")
    check("a thing has to be given a name, and not the crop's own: the window says so and adds nothing", go1 is False and no_name["open"] is True and "name" in no_name["said"] and no_name["undo"] == 0 and same_name["open"] is True and "already sells" in same_name["said"] and same_name["undo"] == 0, [no_name, same_name])
    page.keyboard.press("Escape"); wait(200)
    w, b1 = add(B, "Small ones", "lb", "bed"); s1 = snap(); st = last_step(); t1 = js("return { toast: toast(), things: things(arg), record: JSON.parse(record(arg)) };", B)
    check("added, it is one step that changes the list and nothing else, and its record has an id of its own that begins the way every thing's does", isinstance(b1, str) and b1.startswith("t-") and len(b1) > 20 and st["n"] == 1 and st["kinds"] == ["assume"] and list(t1["record"].keys()) == [b1] and nth(list(t1["record"].values()), 0)["id"] == b1 and nth(list(t1["record"].values()), 0)["from"] == "bed", {"id": b1, "step": st, "record": t1["record"]})
    check("the message says it is not counted yet and what it waits on (its price, its share of each bed, its yield), and that the season's worth stays", "not counted yet" in t1["toast"] and "its price" in t1["toast"] and "its share of each bed" in t1["toast"] and "its yield" in t1["toast"] and said(t1["toast"]) == (dollars(snap0["worth"]), dollars(snap0["worth"])), t1["toast"])
    check("nothing in the forecast moved, and no planting's days: an empty thing counts for nothing", s1["whole"] == snap0["whole"] and s1["dates"] == snap0["dates"] and s1["worth"] == snap0["worth"], {"worth": [snap0["worth"], s1["worth"]]})
    c1 = card(); head1 = next((h for h in c1["heads"] if h["thing"] == b1), Missing())
    check("the card has a column for it after the crop's own, headed with its name and “not counted yet”; “Share of each bed” is there now and “Share of the harvest” is not; no helper row, since its yield is in its own unit", "Small ones" in head1["text"] and "not counted yet" in head1["text"] and head1["counts"] == "false" and "sharebed" in c1["order"] and "sharepack" not in c1["order"] and "helper" not in c1["order"] and pos(c1["order"], "sharebed") == pos(c1["order"], "price") + 1, {"heads": c1["heads"], "order": c1["order"]})
    check("its price, its share and its yield are amber and empty, named beside the button as still empty, and under the grid the card says it is not counted and that the crop is forecast as if it had not been added", all(c1["boxes"][f"t|{b1}|{k}"]["amber"] is True and c1["boxes"][f"t|{b1}|{k}"]["value"] == "" for k in ("price", "share", "yield")) and "Small ones: its price" in c1["still"] and any("Small ones is not counted yet" in x and "as if Small ones had not been added" in x for x in c1["waits"]), {"boxes": c1["boxes"], "still": c1["still"], "waits": c1["waits"]})
    check("the first picking of a thing is the crop's own while its box for days before is empty: the box is there, empty and not amber, said to be days before", "days before" in c1["rows"]["first"]["things"][b1] and c1["boxes"].get(f"t|{b1}|before", {}).get("value") == "" and c1["boxes"].get(f"t|{b1}|before", {}).get("amber") is False, [c1["rows"]["first"], c1["boxes"].get(f"t|{b1}|before")])
    sd1 = js("const b = document.querySelector('#ycList .yc-item[data-crop=\"' + arg + '\"]'); return { say: b.querySelector('small').textContent, open: b.classList.contains('open'), left: +$('ycLeft').dataset.left, text: txt('ycLeft') };", B)
    check("the crop is marked on the checklist as having a thing waiting, and is counted among the crops left to set, which says a thing may be what waits", "1 thing waiting" in sd1["say"] and sd1["open"] is True and sd1["left"] == left0 + 1 and "thing still waiting" in sd1["text"], [sd1, left0])
    check("the yield of a thing out of each bed says under its box what it is a yield of: a bed-foot of its share, in all", "of its share, in all" in c1["rows"]["yield"]["things"][b1] and "bed-foot" in c1["rows"]["yield"]["things"][b1], c1["rows"]["yield"])
    click('[data-ah-way="list"]', 700); amber = js("const td = document.querySelector('#ahBody tr.as-thing[data-thing=\"' + arg + '\"] td.ah-price'), i = td && td.querySelector('input'), other = document.querySelector('#ahBody tr.as-crop td.ah-price input'); return td ? { cls: td.classList.contains('amber'), bg: getComputedStyle(i).backgroundColor, plain: getComputedStyle(other).backgroundColor, state: td.closest('tr').querySelector('.as-tstate').textContent } : null;", b1)
    click('[data-ah-way="card"]', 600); open_crop(B)
    check("on “All on one page” a thing's empty price is an amber box, as on the card, and its line says what it waits on", amber["cls"] is True and amber["bg"] != amber["plain"] and "waits on its price" in amber["state"], amber)
    if has(box(b1, "unit")): page.locator(box(b1, "unit")).focus(); page.keyboard.press("b"); wait(500)
    let1 = js("return { unit: things(arg[0]).find(t => t.id === arg[1]).unit, asked: !!document.querySelector('dialog[open]'), undo: S.undo.length, focus: (document.activeElement.dataset || {}).yk || '' };", [B, b1])
    if has(box(b1, "price")): page.locator(box(b1, "price")).focus(); page.keyboard.press("q"); wait(300)
    let2 = js("return { unit: things(arg[0]).find(t => t.id === arg[1]).unit, value: document.activeElement.value, undo: S.undo.length };", [B, b1])
    check("a letter on a thing's own “Sold by” picks the unit it begins, as on the crop's (b: bunch), asking nothing of a thing with no figure yet; in a number box a letter does nothing", let1["unit"] == "bunch" and let1["asked"] is False and let1["undo"] == 2 and let1["focus"] == f"t|{b1}|unit" and let2["unit"] == "bunch" and let2["value"] == "" and let2["undo"] == 2, [let1, let2])
    undo(); open_crop(B)
    a1 = fill(b1, "price", 5); p1 = js("return { toast: toast(), whole: snap().whole };"); a2 = fill(b1, "share", 30); p2 = js("return { toast: toast(), whole: snap().whole, undo: S.undo.length };")
    check("a price and a share typed while the yield is still empty ask nothing and move nothing: each says it is not counted yet and that the season's worth stays", not a1 and not a2 and "not counted yet" in p1["toast"] and "its yield" in p2["toast"] and said(p2["toast"]) == (dollars(snap0["worth"]), dollars(snap0["worth"])) and p1["whole"] == snap0["whole"] and p2["whole"] == snap0["whole"] and p2["undo"] == 3, [p1["toast"], p2["toast"]])
    lab = card()["rows"]["yield"]["things"][b1]
    check("once its share is typed the label names it: a bed-foot of its 30 %, so the figure is not taken for the whole bed's", "a bed-foot of its 30 %, in all" in lab, lab)
    # Enter and the mouse, while a box of the thing is still empty
    if has(box(b1, "price")): page.locator(box(b1, "price")).click(); page.keyboard.press("Enter"); wait(500)
    en = js("return { focus: (document.activeElement.dataset || {}).yk || document.activeElement.id, looked: S.engine.harvestFor(arg).looked, crop: card().crop, undo: S.undo.length };", B)
    click("#ycNext", 500); ms = js("return { looked: S.engine.harvestFor(arg).looked, toast: toast(), undo: S.undo.length };", B)
    check("Enter goes to the thing's empty box and ticks nothing while it waits; the button pressed with the mouse ticks the crop and says what is still empty", en["focus"] == f"t|{b1}|yield" and not en["looked"] and en["crop"] == B and en["undo"] == 3 and ms["looked"] == year and "still empty" in ms["toast"] and "Small ones: its yield" in ms["toast"] and ms["undo"] == 4, [en, ms])
    undo(); open_crop(B)
    sA = snap(); a3 = fill(b1, "yield", 0.5, yes=False); sB = snap()
    check("the figure that completes it asks first: the window says it is counted from now on, what the plan counts today and with it, and the season's worth before and after", bool(a3) and "counted from now on" in a3["text"] and "Small ones" in a3["text"] and bool(said(a3["text"])) and said(a3["text"])[0] == dollars(sA["worth"]) and said(a3["text"])[0] != said(a3["text"])[1], a3)
    check("turned down, nothing is changed: the plan, the forecast and the list of steps are what they were, and the box is empty again", sB["plan"] == sA["plan"] and sB["whole"] == sA["whole"] and sB["undo"] == sA["undo"] and card()["boxes"][f"t|{b1}|yield"]["value"] == "", {"undo": [sA["undo"], sB["undo"]]})
    typed(box(b1, "yield"), "0.5"); a3 = asking(); f3 = focus(); page.keyboard.press("Enter"); wait(700); sC = snap(); st = last_step(); tC = js("return toast();"); f4 = focus()
    check("the window opens with “Apply” in focus, so that Enter after the figure takes it; it gives the old worth, the new, and the difference in words; when it closes the pointer for typing is in the next empty box, or on “Looks right” where none is left", f3 == "window: Apply" and sC["undo"] == sA["undo"] + 1 and differs(a3["text"], sA["worth"], sC["worth"]) and differs(tC, sA["worth"], sC["worth"]) and f4 == "ycNext" and not asking(), {"focus": [f3, f4], "text": a3["text"], "worth": [sA["worth"], sC["worth"]]})
    check("agreed to, it is one step, and the forecast's worth is then the figure the window gave, to the dollar; the message says so again with an Undo", bool(a3) and sC["undo"] == sA["undo"] + 1 and st["kinds"] == ["assume"] and said(a3["text"])[1] == dollars(sC["worth"]) and said(tC) == said(a3["text"]) and "counted from now on" in tC and has(".toast button"), {"said": said(a3["text"]), "worth": sC["worth"], "toast": tC})
    bed = js("""const e = S.engine, id = arg[0], t = e.thingsOf(id).find(x => x.id === arg[1]), m = F.build(e), list = S.plan.plantings.filter(p => p.cropId === id).map(p => { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null; return { p, r, y, parts: r ? e.soldOf(p, r, y) : null, f: follows(p) }; });
      const mine = list.filter(x => x.f), row = m.rows.find(r => r.thing === arg[1]), first = m.rows.filter(r => r.cropId === id && !r.thing);
      return { counts: t.counts, n: mine.length, parts: mine.every(x => x.parts && x.parts.length === 2 && near(x.parts[0].units, x.y.units * 0.7) && near(x.parts[1].units, x.y.count * 0.3 * 0.5 * x.y.mk * Math.min(1, x.r.harvestDays / Math.max(1, x.r.expectedHarvestDays))) && x.parts[1].unit === 'lb' && x.parts[1].price === 5),
        rest: list.filter(x => !x.f).every(x => x.parts === null), restN: list.filter(x => x.y && x.y.own).length, row: row ? { unit: row.unit, name: row.name, total: row.total, worth: row.worth, sum: row.plantings.reduce((n, q) => n + q.inYear, 0), by: row.plantings.every(q => near(q.units, mine.find(x => x.p.id === q.p.id).parts[1].units)), n: row.plantings.length } : null,
        first: first.every(r => r.plantings.every(q => { const x = list.find(k => k.p.id === q.p.id); return near(q.units, x.f ? x.y.units * 0.7 : x.y.units); })), sumWorth: near(m.rows.reduce((n, r) => n + r.worth, 0), m.rows.reduce((n, r) => n + r.plantings.reduce((k, q) => k + q.inYear * q.price, 0), 0)) };""", [B, b1])
    check("each bed that follows the crop's line now gives the crop itself 70% of what it gave, and the thing 30% of what the bed is counted by × its yield × the share sold × the part of its harvest it has, in pounds at its own price; a planting with a yield of its own is left whole", bed["counts"] is True and bed["n"] >= 2 and bed["parts"] is True and bed["rest"] is True and bed["restN"] >= 1, bed)
    check("the forecast has a row for the thing, named for the crop and the thing, in its own unit, made of those plantings; the crop's own row is made of what is left; the season's worth is the sum over every row at its own price", bool(bed["row"]) and bed["row"]["unit"] == "lb" and bed["row"]["name"] == f"{nameB} · Small ones" and bed["row"]["by"] is True and bed["row"]["n"] == bed["n"] and abs(bed["row"]["total"] - bed["row"]["sum"]) < 1e-6 and bed["first"] is True and bed["sumWorth"] is True, bed)
    check("no planting's days moved, and no other crop's row of the forecast", sC["dates"] == snap0["dates"] and js("const e0 = window.__before['engine.js'].create(S.plan, LRFLibrary), m = F.build(heldEngine(S.plan, e0)), old = window.__before['forecast.js'].build(e0); const pick = x => whole({ ...x, rows: x.rows.filter(r => r.cropId !== arg) }); return pick(m) === pick(old);", B) is True)
    c2 = card(); head2 = next((h for h in c2["heads"] if h["thing"] == b1), Missing()); rows2 = js("return rowsOf(arg);", B)
    check("the card says “counted”, shows 70 as what is left for the crop itself, and “What it comes to” has a line for the crop and one for the thing, each the forecast's own total and worth", head2["counts"] == "true" and " counted" in head2["text"] and "not counted" not in head2["text"] and c2["left"]["sharebed"] == 70 and len(c2["comes"]) == len(rows2) >= 2 and all(any(k["thing"] == r["thing"] and k["unit"] == r["unit"] and abs(k["total"] - r["total"]) < 1e-6 and abs(k["worth"] - r["worth"]) < 1e-6 for k in c2["comes"]) for r in rows2) and any(k["text"].startswith("Small ones: ") for k in c2["comes"]), {"comes": c2["comes"], "rows": rows2, "left": c2["left"]})
    undo(); sU = snap(); js("A.redo(); return 1;"); wait(300); sR = snap()
    check("one Undo takes the completing figure back, and the forecast is the untouched one again; done again it is as it was", sU["whole"] == snap0["whole"] and sU["undo"] == sC["undo"] - 1 and sR["whole"] == sC["whole"] and sR["plan"] == sC["plan"], {"undo": [sC["undo"], sU["undo"], sR["undo"]]})

    # ── a planting says which of the two it is grown for ──
    gp = js("const ps = S.plan.plantings.filter(p => p.cropId === arg && follows(p)); const view = S.view; A.setView('map'); A.select({ type: 'planting', id: ps[0].id }); return { id: ps[0].id, beside: ps[1].id, view };", B); wait(400)
    seg = lambda: js("const s = $('fGives'); return s ? { now: s.dataset.gives, btns: [...s.querySelectorAll('button')].map(b => [b.dataset.gives, b.textContent, b.getAttribute('aria-pressed')]), help: $('fGivesField').querySelector('small').textContent, line: txt('fYieldLine') } : null;")
    g0 = seg(); u0 = js("return S.undo.length;")
    check("the panel of a planting whose crop sells two things out of one bed asks “This planting is for”: both by shares (pressed), the crop alone, or the thing alone", bool(g0) and g0["now"] == "both" and [b[0] for b in g0["btns"]] == ["both", "first", b1] and [b[2] for b in g0["btns"]] == ["true", "false", "false"] and nth(nth(g0["btns"], 1), 1) == nameB and nth(nth(g0["btns"], 2), 1) == "Small ones", g0)
    click(f"#fGives button[data-gives='{b1}']", 600); g1 = seg(); s1 = snap(); t1g = js("return toast();")
    p1g = js("const p = S.engine.planting(arg[0]), r = S.engine.calc(p), parts = S.engine.soldOf(p, r) || [], q = S.engine.planting(arg[1]), parts2 = S.engine.soldOf(q, S.engine.calc(q)) || []; return { gives: p.gives || '', n: parts.length, thing: (parts[0] || {}).thing || '', unit: (parts[0] || {}).unit || '', beside: parts2.length };", [gp["id"], gp["beside"]])
    check("pressed for the thing, that planting gives the thing on the whole of it and none of the crop's own line; the planting beside it still gives both; it is one step, and the message says what the season's worth does and offers Undo", p1g == {"gives": b1, "n": 1, "thing": b1, "unit": "lb", "beside": 2} and g1["now"] == b1 and s1["undo"] == u0 + 1 and "Small ones only" in t1g and "season’s worth" in t1g and "Undo" in t1g, {"p": p1g, "toast": t1g})
    check("no planting's days moved by it, and the panel's “Expected” line is the thing's alone", s1["dates"] == snap0["dates"] and "Small ones" in g1["line"] and g1["line"].count(";") == 0, g1)
    click("#fGives button[data-gives='first']", 600); g2 = seg(); p2g = js("const p = S.engine.planting(arg), r = S.engine.calc(p); return { gives: p.gives || '', parts: (S.engine.soldOf(p, r) || []).length };", gp["id"])
    check("pressed for the crop alone, it gives the crop's own line, whole", p2g == {"gives": "first", "parts": 0} and g2["now"] == "first", p2g)
    click("#fGives button[data-gives='both']", 600); g3 = seg(); s3 = snap()
    check("pressed for both again, nothing is kept on the planting and the forecast is what it was before it was asked", js("return 'gives' in S.engine.planting(arg) ? 1 : 0;", gp["id"]) == 0 and s3["whole"] == sR["whole"] and g3["now"] == "both", g3)
    js("while (S.undo.length > arg[0]) A.undo(); A.select(null); A.setView(arg[1]); return 1;", [u0, gp["view"]]); wait(400)
    check("three Undos take the three answers back: the plan is the one it was", snap()["plan"] == sR["plan"])

    # shares are held to 100
    open_crop(B); sH = snap(); typed(box(b1, "share"), "101"); over1 = js("return { asked: !!document.querySelector('dialog[open]'), share: things(arg[0]).find(t => t.id === arg[1]).share, undo: S.undo.length, max: document.querySelector('[data-yk=\"t|' + arg[1] + '|share\"]').max, toast: toast() };", [B, b1])
    w, b2 = add(B, "More", "lb", "bed"); fill(b2, "price", 1); n2 = js("return S.undo.length;"); typed(box(b2, "share"), "71"); over2 = js("return { toast: toast(), share: things(arg[0]).find(t => t.id === arg[1]).share, undo: S.undo.length };", [B, b2])
    fill(b2, "share", 70); left = card()
    check("a share over 100 is refused in a sentence (“A share is 0 to 100”), not dropped without a word; with another thing in the same beds, a share that would bring the two past 100 is refused in words (“add up to 100”, and how much is left), and nothing is changed", over1["asked"] is False and over1["share"] == 30 and over1["undo"] == sH["undo"] and "A share is 0 to 100" in over1["toast"] and "add up to 100" in over2["toast"] and "at most 70" in over2["toast"] and not over2["share"] and over2["undo"] == n2, [over1, over2])
    check("a share that fits is taken; the row says the shares add up to 100, and the crop's own column shows what is counted now (70) and what it will be once the other is counted (0)", js("return things(arg[0]).find(t => t.id === arg[1]).share;", [B, b2]) == 70 and "add up to 100" in left["rows"]["sharebed"]["hint"] and left["left"]["sharebed"] == 70 and "0% once" in left["rows"]["sharebed"]["own"], left["rows"]["sharebed"])
    click(f'[data-thing-remove="{b2}"]', 400); wr = asking(); answer(True); sH2 = snap()
    check("a thing that was not counted is taken away with a window that says nothing in the forecast changes; the forecast is what it was", bool(wr) and "nothing in the forecast changes" in wr["text"] and said(wr["text"]) == (dollars(sC["worth"]), dollars(sC["worth"])) and sH2["whole"] == sC["whole"] and "More" not in json.dumps(js("return things(arg);", B)), wr)

    # called something else
    sN = snap(); click(f'[data-thing-name="{b1}"]', 400); wn = asking(); typed("#thRename", "Babies", key="Enter", ms=600); sN2 = snap(); named = js("return { name: things(arg[0]).find(t => t.id === arg[1]).name, rows: rowsOf(arg[0]).map(r => r.name), head: card().heads.find(h => h.thing === arg[1]).text, toast: toast(), id: Object.keys(JSON.parse(record(arg[0]))) };", [B, b1])
    check("“Rename…” changes its name and nothing else: one step, the same id, the same forecast but for the name of its row, and the message says the season's worth stays", bool(wn) and wn["id"] == "thRenameDlg" and named["name"] == "Babies" and f"{nameB} · Babies" in named["rows"] and named["head"].startswith("Babies") and named["id"] == [b1] and sN2["undo"] == sN["undo"] + 1 and sN2["worth"] == sN["worth"] and sN2["dates"] == sN["dates"] and said(named["toast"]) == (dollars(sN["worth"]), dollars(sN["worth"])), named)
    undo(); check("and one Undo gives it its name back", snap()["plan"] == sN["plan"])

    # changed
    sD = snap(); wp = fill(b1, "price", 7); sE = snap(); tp = js("return toast();")
    check("a figure changed on a thing that already counts is applied at once, as a crop's own boxes are: no window, one step, and a message that gives the worth before and after, the difference in words, and an Undo; only the thing's own row is priced anew", not wp and said(tp) == (dollars(sD["worth"]), dollars(sE["worth"])) and differs(tp, sD["worth"], sE["worth"]) and has(".toast button") and sE["worth"] > sD["worth"] and abs((sE["worth"] - sD["worth"]) - bed["row"]["total"] * 2) < 1e-6 and sE["undo"] == sD["undo"] + 1, {"asked": wp, "toast": tp, "worth": [sD["worth"], sE["worth"]]})
    typed(box(b1, "days"), "400"); dz = js("return { toast: toast(), days: things(arg[0]).find(t => t.id === arg[1]).days, undo: S.undo.length, asked: !!document.querySelector('dialog[open]'), most: Math.max(...S.plan.plantings.filter(p => p.cropId === arg[0] && follows(p)).map(p => S.engine.calc(p).harvestDays)) };", [B, b1])
    check("more harvest days than the plantings it comes from have are refused in a sentence that says why (it is never picked after its planting's last picking) and how many days there are; nothing changes", "cannot be picked for 400 days" in dz["toast"] and ("for %d day" % dz["most"] if isinstance(dz["most"], int) else "?") in dz["toast"] and "last picking" in dz["toast"] and not dz["days"] and dz["undo"] == sE["undo"] and dz["asked"] is False, dz)
    page.select_option(box(b1, "pick"), "once"); wait(500); wo = asking()
    if wo: answer(True)
    fill(b1, "days", 5); once = js("""const m = F.build(S.engine), row = m.rows.find(r => r.thing === arg), t = S.engine.thingsOf(row.cropId).find(x => x.id === arg);
      return { last: card().rows.last.things[arg], pattern: t.pattern, days: t.days, yield: t.yield, lots: row.plantings.every(q => +q.from === +q.r.first && q.to <= q.r.last && Math.round((q.to - q.from) / 864e5) + 1 === Math.min(5, q.r.harvestDays) && q.out[0] > 0 && Array.from(q.out).slice(1).every(v => v === 0)), n: row.plantings.length };""", b1)
    check("its own way of picking and its own harvest days: cleared, all of it is counted the first day it is picked; with 5 harvest days it is picked from the planting's first picking and never after its last; no planting's days move", once["pattern"] == "once" and once["days"] == 5 and once["yield"] == 0.5 and once["lots"] is True and once["n"] >= 2 and snap()["dates"] == snap0["dates"], once)
    check("where a thing cleared in one day is put on the crop's first picking day, the card names that day and says days before give it a day of its own", f"the day {nameB} is first picked" in once["last"] and "day of its own" in once["last"], once["last"])
    page.select_option(box(b1, "pick"), "weekly"); wait(500); ww = asking()
    if ww: answer(True)
    weekly = js("const t = S.engine.thingsOf(arg[0]).find(x => x.id === arg[1]), e = S.engine, list = S.plan.plantings.filter(p => p.cropId === arg[0] && follows(p)).map(p => { const r = e.calc(p), y = e.yieldOf(p, r); return { r, y, parts: e.soldOf(p, r, y) }; }); return { pattern: t.pattern, yield: t.yield, parts: list.every(x => near(x.parts[1].units, x.y.count * 0.3 * t.yield * Math.min(5, x.r.harvestDays) / 7 * x.y.mk)), cell: card().rows.yield.things[arg[1]] };", [B, b1])
    check("turned to “Gradually”, its yield is written as a week's picking, the same over its harvest days (0.5 over 5 days is 0.7 a week), and each bed gives its share × that × the days it is picked ÷ 7", weekly["pattern"] == "weekly" and abs(weekly["yield"] - 0.7) < 1e-9 and weekly["parts"] is True and "a week" in weekly["cell"], weekly)
    undo_to(sE["undo"]); sE2 = snap()
    check("with those steps undone the thing is what it was: one Undo each", sE2["whole"] == sE["whole"] and sE2["plan"] == sE["plan"])

    # a unit changed
    click("#ycNext", 500); open_crop(B); ticked = js("return S.engine.harvestFor(arg).looked;", B); sF = snap()
    page.select_option(box(b1, "unit"), "bunch"); wait(500); wu = asking(); answer(False); sG = snap()
    check("a unit changed asks first: no figure is turned into the new unit, the price stays and what it will mean is said, and the crop's tick for the year comes off; turned down, nothing changes", ticked == year and bool(wu) and "No figure is turned into the new unit" in wu["text"] and "the price stays $7" in wu["text"] and "for a bunch" in wu["text"] and "tick" in wu["text"] and sG["plan"] == sF["plan"] and card()["boxes"][f"t|{b1}|unit"]["value"] == "lb", wu)
    page.select_option(box(b1, "unit"), "bunch"); wait(500); wu = asking(); answer(True); un = js("return { t: things(arg[0]).find(t => t.id === arg[1]), looked: S.engine.harvestFor(arg[0]).looked, undo: S.undo.length, row: rowsOf(arg[0]).find(r => r.thing === arg[1]) };", [B, b1])
    check("agreed to, it is one step: the thing is sold by the new unit, its price and its yield are the figures typed, the tick is off, and its row of the forecast is in the new unit", un["t"]["unit"] == "bunch" and un["t"]["price"] == 7 and un["t"]["yield"] == 0.5 and not un["looked"] and un["undo"] == sF["undo"] + 1 and un["row"]["unit"] == "bunch", un)
    undo(); undo(); sG2 = snap()
    check("one Undo puts the unit back, and one more the tick's step: the plan is what it was before the crop was ticked", sG2["plan"] == sE["plan"], {"undo": [sE["undo"], sG2["undo"]]})

    # taken away
    open_crop(B); click(f'[data-thing-remove="{b1}"]', 400); wt = asking(); answer(False); sT0 = snap()
    click(f'[data-thing-remove="{b1}"]', 400); wt2 = asking(); answer(True); sT = snap(); stT = last_step(); cT = card()
    check("“Take away…” asks first, with the season's worth before and after; turned down, the thing stays", bool(wt) and "Take Small ones away" in wt["title"] and said(wt["text"]) == (dollars(sE["worth"]), dollars(snap0["worth"])) and sT0["plan"] == sE["plan"], wt)
    check("taken away, it is one step; its column, the share row and its line under the grid are gone; the forecast is the untouched plan's, whole, and the plan holds nothing of it", stT["n"] == sE["undo"] + 1 and all(not h["thing"] for h in cT["heads"]) and "sharebed" not in cT["order"] and sT["whole"] == snap0["whole"] and sT["plan"] == snap0["plan"] and sT["worth"] == snap0["worth"], {"heads": cT["heads"], "order": cT["order"]})
    undo(); sT2 = snap()
    check("one Undo brings it back with every figure, counted as before", sT2["plan"] == sE["plan"] and sT2["whole"] == sE["whole"])

    # ══ a different thing from one place ══
    open_crop(P); cP0 = card(); click("#ycAdd", 400); opts = js("return { off: document.querySelector('input[name=thFrom][value=place]').disabled, places: [...document.querySelectorAll('#thPlace option')].map(o => o.value) };"); page.keyboard.press("Escape"); wait(200)
    check("for a crop planted in more than one kind of place the window offers a place of its own, among the places the crop is planted in", opts["off"] is False and sub["place"] in opts["places"] and len(opts["places"]) >= 2 and set(opts["places"]) <= set(h["place"] for h in cP0["heads"]), opts)
    sP0 = snap(); w, p1 = add(P, "By weight", "lb", "place", sub["place"]); cP1 = card(); recP = js("return JSON.parse(record(arg[0]))[arg[1]];", [P, p1])
    check("sold by the pound from a crop that is counted, its yield is typed in what is counted and the helper row “… weighs, packed” is shown: the record says which unit its yield is counted in", recP["counted"] == sub["units"]["placed"] and recP["place"] == sub["place"] and "helper" in cP1["order"] and "weighs, packed" in cP1["rows"]["helper"]["label"] and pos(cP1["order"], "helper") == pos(cP1["order"], "yield") + 1 and f"t|{p1}|helper" in cP1["boxes"] and cP1["boxes"][f"t|{p1}|helper"]["amber"] is True and "not needed" in cP1["rows"]["helper"]["own"], {"record": recP, "rows": cP1["rows"].get("helper")})
    check("until it counts, that place is still a column of the crop's own, since its plantings are still sold as the crop", any(h["place"] == sub["place"] for h in cP1["heads"]) and len([h for h in cP1["heads"] if h["place"]]) == len([h for h in cP0["heads"] if h["place"]]), cP1["heads"])
    own_amber = [k for k, v in cP1["boxes"].items() if k.startswith("y|") and v["amber"] is True] if cP1 else []
    typed(box(p1, "price"), "6", key="Tab"); k1f = focus(); typed(box(p1, "yield"), "0.8", key="Enter"); k2f = focus(); k2 = js("return { looked: S.engine.harvestFor(arg).looked, crop: card().crop };", P)
    check("Tab from a new thing's Price goes to that thing's own next empty box, and Enter after its yield to its helper box, though the crop's own yield stands empty and amber before them on the card; nothing is ticked", len(own_amber) >= 1 and k1f == f"t|{p1}|yield" and k2f == f"t|{p1}|helper" and not k2["looked"] and k2["crop"] == P, {"own": own_amber, "tab": k1f, "enter": k2f})
    sP1 = snap(); tP = js("return toast();")
    check("with a price and a yield it still waits on what one weighs: not counted, and the forecast has not moved", "weighs" in tP and "not counted yet" in tP and sP1["whole"] == sP0["whole"], tP)
    wP = fill(p1, "helper", 0.5); fP = focus(); sP2 = snap()
    check("after the window that completes it, the pointer for typing is in the next box still empty: the crop's own", fP in own_amber, {"focus": fP, "own": own_amber})
    place = js("""const e = S.engine, id = arg[0], env = arg[2], list = S.plan.plantings.filter(p => p.cropId === id).map(p => { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null; return { p, r, y, parts: r ? e.soldOf(p, r, y) : null, f: follows(p), env: r ? e.envOf(r.b) : null }; });
      const there = list.filter(x => x.f && x.env === env), m = F.build(e), row = m.rows.find(r => r.thing === arg[1]), first = m.rows.filter(r => r.cropId === id && !r.thing);
      return { n: there.length, parts: there.every(x => x.parts && x.parts.length === 1 && x.parts[0].thing === arg[1] && x.parts[0].unit === 'lb' && near(x.parts[0].units, x.y.count * 0.8 * 0.5 * x.y.mk * Math.min(1, x.r.harvestDays / Math.max(1, x.r.expectedHarvestDays)))), away: list.filter(x => x.env !== env || !x.f).every(x => x.parts === null),
        row: row ? { n: row.plantings.length, unit: row.unit, total: row.total, worth: row.worth } : null, gone: first.every(r => r.plantings.every(q => !there.some(x => x.p.id === q.p.id))) };""", [P, p1, sub["place"]])
    check("the helper figure completes it: the window gives the worth before and after, and the forecast then shows that worth", bool(wP) and "counted from now on" in wP["text"] and said(wP["text"]) == (dollars(sP1["worth"]), dollars(sP2["worth"])) and sP2["undo"] == sP1["undo"] + 1, {"said": said(wP["text"]) if wP else None, "worth": [sP1["worth"], sP2["worth"]]})
    check("every planting in that place that follows the crop's line is now sold as the thing alone: what it is counted by × the yield × what one weighs × the share sold; plantings elsewhere, and any with a yield of its own, are the crop's own line, whole", place["n"] >= 1 and place["parts"] is True and place["away"] is True and bool(place["row"]) and place["row"]["n"] == place["n"] and place["row"]["unit"] == "lb" and place["gone"] is True and abs(place["row"]["worth"] - place["row"]["total"] * 6) < 1e-6, place)
    cP2 = card(); headP = next((h for h in cP2["heads"] if h["thing"] == p1), Missing())
    check("on the card that place is no longer a column of the crop's own: it is the thing's, which names the place and its plantings", not any(h["place"] == sub["place"] for h in cP2["heads"]) and len([h for h in cP2["heads"] if h["place"]]) == len([h for h in cP0["heads"] if h["place"]]) - 1 and "planting" in headP["text"] and headP["counts"] == "true", cP2["heads"])
    fed = js("const row = F.build(S.engine).rows.find(r => r.thing === arg), q = row.plantings[0]; return { id: q.p.id, said: F.amount(q.units, row.unit, 'produce'), worth: '$' + Math.round(q.units * q.price).toLocaleString('en-US') };", p1)
    page.evaluate("id => { LRFApp.setView('map'); LRFApp.select({ type: 'planting', id }); }", fed["id"] if isinstance(fed["id"], str) else ""); wait(900)
    line = js("const el = $('fYieldLine'); return el ? { text: el.textContent, things: el.dataset.things || '' } : null;")
    check("the panel of a planting that feeds a thing says what it is expected to give of the thing, in the thing's unit and at the thing's price, not the crop's", line["things"] == "1" and f"By weight, {fed['said']} at $6" in line["text"] and str(fed["worth"]) in line["text"] and "sells more than one thing" in line["text"], [line, fed])
    page.evaluate("LRFApp.select(null)"); card_page(); open_crop(P)
    click("#ycAdd", 400); opts2 = js("return { off: document.querySelector('input[name=thFrom][value=place]').disabled, places: [...document.querySelectorAll('#thPlace option')].map(o => o.value) };"); page.keyboard.press("Escape"); wait(200)
    check("a place that has a thing is not offered to another, and the last place left to the crop itself is not offered at all", sub["place"] not in opts2["places"] and (opts2["off"] is True) == (len(opts2["places"]) == 0) and (len(sub["places"]) > 2 or opts2["off"] is True), opts2)

    # ══ one harvest, packed two ways ══
    sK0 = snap(); w, k1 = add(K, "Bouquets", "bouquet", "harvest"); cK1 = card()
    check("a thing packed from the harvest has “Share of the harvest” and no “Share of each bed”; its helper row asks what a bouquet takes; it has no yield and no way of picking of its own, and each of those cells says why", "sharepack" in cK1["order"] and "sharebed" not in cK1["order"] and "A bouquet takes" in cK1["rows"]["helper"]["label"] and "none of its own" in cK1["rows"]["yield"]["things"][k1] and "as " in cK1["rows"]["pick"]["things"][k1] and f"t|{k1}|yield" not in cK1["boxes"] and f"t|{k1}|pick" not in cK1["boxes"], cK1["rows"])
    fill(k1, "price", 12); fill(k1, "share", 40); sK1 = snap(); wK = fill(k1, "helper", 10); sK2 = snap()
    pack = js("""const e = S.engine, id = arg[0], list = S.plan.plantings.filter(p => p.cropId === id && follows(p)).map(p => { const r = e.calc(p), y = e.yieldOf(p, r); return { p, r, y, parts: e.soldOf(p, r, y) }; }), m = F.build(e), row = m.rows.find(r => r.thing === arg[1]), first = m.rows.find(r => r.cropId === id && !r.thing);
      return { n: list.length, parts: list.every(x => x.parts && x.parts.length === 2 && near(x.parts[0].units, x.y.units * 0.6) && near(x.parts[1].units, x.y.units * 0.4 / 10) && x.parts[1].unit === 'bouquet' && x.parts[1].pattern === x.y.pattern),
        days: !!row && !!first && row.plantings.every(q => { const o = first.plantings.find(k => k.p.id === q.p.id); return !!o && o.lo === q.lo && o.out.length === q.out.length; }), row: row ? { unit: row.unit, group: row.group, total: row.total, worth: row.worth } : null, stems: F.glance(m, 0, m.days - 1).stems, own: m.rows.filter(r => r.group === 'flower' && !r.thing).reduce((n, r) => n + F.sum(r.days, 0, m.days - 1), 0) };""", [K, k1])
    check("not counted until the helper figure is typed; then the window gives the worth before and after and the forecast shows it", sK1["whole"] == sK0["whole"] and bool(wK) and said(wK["text"]) == (dollars(sK1["worth"]), dollars(sK2["worth"])), {"said": said(wK["text"]) if wK else None, "worth": [sK1["worth"], sK2["worth"]]})
    check("each planting gives the thing 40% of its harvest ÷ what one holds, and the crop itself the other 60%, picked on the same days", pack["n"] >= 1 and pack["parts"] is True and pack["days"] is True and pack["row"]["unit"] == "bouquet", pack)
    cK2 = card()
    check("the card shows 60 as the share of the harvest left for the crop itself", cK2["left"]["sharepack"] == 60 and "sharebed" not in cK2["left"], cK2["left"])

    # ══ every page, each thing in its own unit ══
    full = snap(); model = js("const m = F.build(S.engine); return { rows: m.rows.filter(r => r.total > 0).map(r => ({ key: r.key, crop: r.cropId, thing: r.thing || '', name: r.name, unit: r.unit, group: r.group, total: r.total, worth: r.worth, said: F.amount(r.total, r.unit, r.group) })), worth: m.rows.reduce((n, r) => n + r.worth, 0), crops: F.cropCount(m.rows.filter(r => r.total > 0)), stems: F.glance(m, 0, m.days - 1).stems };")
    mine = [r for r in model["rows"] if r["thing"] in (b1, p1, k1)]
    page.evaluate("LRFApp.setView('harvest')"); wait(900)
    hv = js("""const rows = [...document.querySelectorAll('#hvTable tr.hv-row')].map(tr => ({ crop: tr.dataset.crop, thing: tr.dataset.thing || '', name: tr.querySelector('.hv-crop span:not(.caret)').textContent, unit: tr.querySelector('.hv-crop small').textContent, total: tr.querySelector('.hv-total').textContent.trim(), worth: tr.querySelector('.hv-total').title }));
      const foot = document.querySelector('#hvTable tfoot .hv-total').textContent, chip = document.querySelector('[data-hv-group="all"] small').textContent, sum = [...document.querySelectorAll('#hvTable tr.hv-sum')].map(tr => [tr.querySelector('.hv-name').textContent, tr.querySelector('.hv-total').textContent]), tiles = txt('hvTiles').replace(/\\s+/g, ' ');
      return { rows, foot, chip, sum, tiles };""")
    check("the Harvest page has a row for each thing, named for the crop and the thing, with its own unit and the forecast's own total", len(mine) == 3 and all(any(h["thing"] == r["thing"] and h["name"] == r["name"] and h["total"] == r["said"] for h in hv["rows"]) for r in mine) and len(hv["rows"]) == len(model["rows"]), {"mine": mine, "page": [h for h in hv["rows"] if h["thing"]]})
    check("its worth for the season is the forecast's, the sum over things; a crop that sells two things is counted as one crop; a bouquet adds nothing to “All stems”", hv["foot"] == "$" + dollars(model["worth"]) and abs(model["worth"] - full["worth"]) < 1e-9 and hv["chip"] == str(model["crops"]) and model["crops"] == len(model["rows"]) - 3 and any(s[0] == "All stems" and s[1].replace(",", "") == str(int(pack["own"] + 1e-6)) for s in hv["sum"]) and abs(pack["stems"] - pack["own"]) < 1e-6, {"foot": hv["foot"], "worth": model["worth"], "chip": hv["chip"], "crops": model["crops"], "sum": hv["sum"], "stems": [pack["stems"], pack["own"]]})
    click("#hvShareBtn", 500)
    if has("#hvShareRange"): page.select_option("#hvShareRange", "months"); wait(300)
    sheet = js("""const m = LRFHarvestView.model('commercial'), s = F.season(m), cols = F.periods(m, 'month', s.i0, s.i1), text = txt('hvSheet'), lines = text.split('\\n');
      const want = []; let at = -1;
      for (const c of cols) { at = lines.findIndex((l, i) => i > at && l === F.MONTHS[c.start.getMonth()] + ' ' + m.year); for (const row of m.rows) { if (!arg.includes(row.thing)) continue; const q = F.sum(row.days, c.i0, c.i1); if (!(F.shown(q) > 0)) continue; const line = '    ' + row.name + ': ' + F.amount(q, row.unit, row.group), end = lines.findIndex((l, i) => i > at && l === ''); want.push({ line, there: lines.slice(at, end < 0 ? undefined : end).includes(line) }); } }
      const figures = m.rows.filter(r => arg.includes(r.thing)).map(r => [r.name, r.unit, ...cols.map(c => F.sendShown(F.sum(r.days, c.i0, c.i1), r.unit))]);
      return { want: want.length, missing: want.filter(w => !w.there).slice(0, 4), months: cols.length, figures };""", [b1, p1, k1])
    check("“A list to send…” has a line for each thing in each month it is there, “Crop · Thing: amount”, in the thing's own unit and the forecast's own amount for that month", sheet["want"] >= 3 and sheet["missing"] == [], sheet)
    csv = ""
    try:
        with page.expect_download(timeout=20000) as dl: page.click("#hvCsv")
        saved = os.path.join(str(shots), "things.csv"); dl.value.save_as(saved); csv = open(saved, encoding="utf-8").read()
    except Exception as e: errors.append("spreadsheet: " + str(e)[:160])
    lines = [[c.strip('"') for c in l.split('","')] for l in csv.splitlines()]
    want_things = sheet["figures"]
    got_things = [[l[1], l[3], *map(float, l[4:])] for l in lines[1:] if len(l) > 4 and l[2] == "All" and l[1] in [r[0] for r in want_things]]
    check("the spreadsheet gives each thing's unit and amounts in the reviewed months", len(want_things) == 3 and got_things == want_things, got_things)
    page.keyboard.press("Escape"); wait(300)

    # a run to an amount a week, on the Successions page (0.84: where "plan to a weekly amount" opened the series tool)
    if has(f'#hvTable tr.hv-row[data-thing="{k1}"]'): page.locator(f'#hvTable tr.hv-row[data-thing="{k1}"]').hover(); wait(200)
    click(f'#hvTable tr.hv-row[data-thing="{k1}"] .hv-plan', 2500)
    sr = js("""const D = LRFSuccessions.state.D, e = S.engine, sel = document.querySelector('[data-hook="succ-thing"]'), r = D.cropId ? LRFSuccession.planRun(e, { cropId: D.cropId, by: 'amount', want: +D.want, thing: D.thing || undefined, datesFor: D.datesFor, from: D.from, to: D.to, gardenIds: D.gardenId ? [D.gardenId] : [], then: D.then }) : { error: 'no crop' };
      return { view: S.view, crop: D.cropId, thing: D.thing, by: D.by, title: txt('suTitle'), options: sel ? [...sel.options].map(o => ({ value: o.value, text: o.textContent, on: o.selected })) : null, weeks: (document.querySelector('[data-hook="succ-weeks"] h4') || {}).textContent || '',
        err: r.error || null, unit: r.error ? null : r.totals.unit, by2: r.error || !r.rests ? null : r.rests.by };""", k1)
    check("“plan…” on a thing's row opens the Successions page on that thing, to an amount a week: “Sold by” lists the crop's own line and each thing with its unit, the thing is the one chosen, and the heading names it", sr["view"] == "succession" and sr["crop"] == K and sr["thing"] == k1 and sr["by"] == "amount" and bool(sr["options"]) and len(sr["options"]) == 2 and nth(sr["options"], 1).get("on") and "bouquet" in sr["title"].lower(), sr)
    check("the run is worked out on what a bed gives of that thing, in its unit, and the weeks are counted in it", not sr["err"] and sr["unit"] == "bouquet" and sr["by2"] == "thing" and "bouquets a week" in sr["weeks"].lower(), sr)
    if has('[data-hook="succ-thing"]'): page.select_option('[data-hook="succ-thing"]', ""); wait(1500)
    sr2 = js("const D = LRFSuccessions.state.D; return { thing: D.thing, title: txt('suTitle'), weeks: (document.querySelector('[data-hook=\"succ-weeks\"] h4') || {}).textContent || '' };")
    check("chosen the other way, the amount is of the crop's own line, in the crop's own unit", sr2["thing"] == "" and "bouquet" not in sr2["title"].lower() and "bouquet" not in sr2["weeks"].lower() and bool(sr2["weeks"]), sr2)
    check("looking at the Harvest page, the list to send and the weekly amount changed nothing in the plan", snap()["plan"] == full["plan"])

    # all on one page
    card_page(); click('[data-ah-way="list"]', 800)
    lst = js("""return [...document.querySelectorAll('#ahBody tr.as-thing')].map(tr => ({ ...tr.dataset, text: tr.innerText.replace(/\\s+/g, ' ').trim(), after: tr.previousElementSibling ? (tr.previousElementSibling.dataset.crop || '') : '', price: (tr.querySelector('input[data-hk]') || {}).value }));""")
    eng = {t["id"]: t for cid in (B, P, K) for t in js("return things(arg);", cid)}
    def agrees(row):
        t = eng.get(row["thing"], Missing()); r = next((m for m in mine if m["thing"] == row["thing"]), Missing())
        helper = t["weighs"] if t["from"] != "harvest" or t["way"] == "weighs" else t["holds"]
        return (row["unit"] == t["unit"] and val(row["price"]) == val(t["price"]) and val(row["share"]) == val(t["share"]) and val(row["yield"]) == val(t["yield"]) and val(row["helper"]) == val(helper) and row["counts"] == "true"
                and val(row["total"]) is not None and abs(val(row["total"]) - r["total"]) < 1e-9 and abs(val(row["worth"]) - r["worth"]) < 1e-9 and t["name"] in row["text"] and "counted" in row["text"] and "not counted" not in row["text"])
    check("“All on one page” has a line under its crop for each thing, with the same unit, price, share, yield and helper figure as its column on the card, the forecast's own total and worth, and “counted”", len(lst) == 3 and all(agrees(r) for r in lst) and all(r["after"] == r["crop"] or any(o["thing"] != r["thing"] and o["crop"] == r["crop"] for o in lst) for r in lst), lst)
    sL = snap(); typed(f'#ahBody tr.as-thing[data-thing="{k1}"] input[data-hk]', "15"); wl = asking(); tl = js("return toast();"); sL2 = snap()
    check("a price typed on the list is applied at once, as on the card, with a message that gives the worth before and after; the forecast shows that worth", not wl and said(tl) == (dollars(sL["worth"]), dollars(sL2["worth"])) and sL2["worth"] > sL["worth"] and sL2["undo"] == sL["undo"] + 1, {"asked": wl, "toast": tl, "worth": [sL["worth"], sL2["worth"]]})
    # a thing that counts never stops counting without a window: the crop's own unit, changed on the list
    def choose(sel, value, ms=700):
        if has(sel): page.select_option(sel, value)
        wait(ms); return asking()
    wu1 = choose(f'#ahBody [data-hk="unit|{K}"]', "bunch"); answer(False); sL3 = snap(); shown = js("return (document.querySelector('#ahBody [data-hk=\"unit|' + arg + '\"]') || {}).value;", K)
    check("on “All on one page”, changing the unit of a crop whose harvest is packed as a thing asks first: the window names the thing, says it would no longer be counted, and gives the season's worth before and after; turned down, nothing changes and the list shows the unit it had", bool(wu1) and "Bouquets would no longer be counted" in wu1["text"] and bool(said(wu1["text"])) and said(wu1["text"])[0] == dollars(sL2["worth"]) and said(wu1["text"])[0] != said(wu1["text"])[1] and sL3["plan"] == sL2["plan"] and shown == sub["units"]["packed"], [wu1, shown])
    wu2 = choose(f'#ahBody [data-hk="unit|{K}"]', "bunch"); answer(True); sL4 = snap()
    check("agreed to, it is one step, and the forecast's worth is the figure the window gave, with the difference in words", bool(wu2) and said(wu2["text"]) == (dollars(sL2["worth"]), dollars(sL4["worth"])) and differs(wu2["text"], sL2["worth"], sL4["worth"]) and sL4["undo"] == sL2["undo"] + 1 and k1 not in [r["thing"] for r in js("return rowsOf(arg);", K)], {"said": said(wu2["text"]) if wu2 else None, "worth": [sL2["worth"], sL4["worth"]]})
    undo(); wait(300)
    # and a variety given a unit of its own: its plantings leave the things
    vsub = js("for (const row of F.build(S.engine).rows) { if (!row.thing) continue; for (const q of row.plantings) { const v = S.engine.variety(q.p.varietyId); if (v && v.cropId === row.cropId) return { v: v.id, crop: row.cropId, thing: row.thing, name: row.sold, n: row.plantings.length, mine: row.plantings.filter(k => k.p.varietyId === v.id).length }; } } return null;")
    if has(f'#ahBody tr.as-crop[data-crop="{vsub["crop"]}"] .as-more') and not has(f'#ahBody [data-hk="vunit|{vsub["v"]}"]'): click(f'#ahBody tr.as-crop[data-crop="{vsub["crop"]}"] .as-more', 500)
    sV0 = snap(); wv1 = choose(f'#ahBody [data-hk="vunit|{vsub["v"]}"]', "pint"); answer(False); sV1 = snap()
    wv2 = choose(f'#ahBody [data-hk="vunit|{vsub["v"]}"]', "pint"); answer(True); sV2 = snap()
    fedby = "would be fed by %s planting" % (vsub["n"] - vsub["mine"]) if isinstance(vsub["n"], int) else "?"
    check("giving a variety a unit of its own, which takes its plantings out of a thing, asks first too: the window names the thing and how many plantings would feed it, with the worth before and after; turned down nothing changes; agreed to, the forecast shows that worth", bool(wv1) and str(vsub["name"]) in wv1["text"] and fedby in wv1["text"] and sV1["plan"] == sV0["plan"] and bool(wv2) and said(wv2["text"]) == (dollars(sV0["worth"]), dollars(sV2["worth"])) and sV2["undo"] == sV0["undo"] + 1, {"sub": vsub, "window": wv1, "worth": [sV0["worth"], sV2["worth"]]})
    undo(); wait(300); card_page(); click('[data-ah-way="card"]', 500); open_crop(K); cL = card()
    check("the card shows the price typed on the list", cL["boxes"][f"t|{k1}|price"]["value"] == "15" and snap()["plan"] == sL2["plan"], cL["boxes"].get(f"t|{k1}|price"))

    # ── the crop's own unit changed under a thing packed from its harvest ──
    sV = snap(); open_crop(K)
    if has('[data-yk="unit"]'): page.select_option('[data-yk="unit"]', "bunch"); wait(600)
    wv = asking(); answer(True)
    sVa = snap()
    check("on the card, the window that asks before the crop's own unit is changed names the thing packed from its harvest, says it would no longer be counted, and gives the season's worth before and after: the worth the forecast then shows", bool(wv) and "Bouquets would no longer be counted" in wv["text"] and said(wv["text"]) == (dollars(sV["worth"]), dollars(sVa["worth"])) and sVa["worth"] != sV["worth"], wv)
    stale = js("const t = things(arg[0]).find(t => t.id === arg[1]); return { counts: t.counts, waits: t.waits, rows: rowsOf(arg[0]).map(r => r.thing) };", [K, k1]); open_crop(K); cV = card()
    check("when the crop itself is sold by another unit, the helper figure typed for the old unit is not read as one for the new: the thing stops counting, its helper box is amber and empty, and the card says what it waits on", stale["counts"] is False and stale["waits"] == ["holds"] and k1 not in stale["rows"] and cV["boxes"][f"t|{k1}|helper"]["amber"] is True and cV["boxes"][f"t|{k1}|helper"]["value"] == "" and any("Bouquets is not counted yet" in x for x in cV["waits"]), {"stale": stale, "waits": cV["waits"]})
    undo_to(sV["undo"]); sV2 = snap()
    check("undone, it counts again as before", sV2["whole"] == sV["whole"] and sV2["plan"] == sV["plan"])

    # ── a laptop's screen: three columns ──
    w, b3 = add(B, "Tops off", "lb", "harvest"); fill(b3, "price", 3); fill(b3, "share", 20); fill(b3, "helper", 0.75)
    vh = 840 if WIDTH <= 1480 else 940 if WIDTH <= 1707 else 1300
    page.set_viewport_size({"width": WIDTH, "height": vh}); wait(300); open_crop(B); wait(200)
    fit = js("""const r = id => $(id).getBoundingClientRect(), trs = [...document.querySelectorAll('#ycGrid tbody tr')], last = trs.pop().getBoundingClientRect(), bar = r('ycActions'), g = r('ycGrid'), c = r('ycCard');
      const spill = [...document.querySelectorAll('#ycGrid td, #ycGrid th')].filter(el => el.scrollWidth > el.clientWidth + 1).length;
      return { cols: document.querySelectorAll('#ycGrid thead th').length - 1, rows: trs.length + 1, last: Math.round(last.bottom), bar: Math.round(bar.top), barIn: bar.bottom <= innerHeight + 0.5, inside: g.left >= c.left - 0.5 && g.right <= c.right + 0.5 && c.right <= innerWidth + 0.5, side: document.documentElement.scrollWidth > innerWidth + 1, spill, order: trs.map(t => t.dataset.row) };""")
    check("a card with three columns (the crop's own, a share of each bed, a share of the harvest) and both share rows fits a laptop's screen (%d by %d): its last row stands above the bar that stays in view, nothing spills sideways, and no cell is cut off" % (WIDTH, vh), fit["cols"] == 3 and fit["last"] <= fit["bar"] and fit["barIn"] is True and fit["inside"] is True and fit["side"] is False and fit["spill"] == 0 and "sharebed" in fit["order"] and "sharepack" in fit["order"], fit)
    shot("three-columns"); page.set_viewport_size({"width": WIDTH, "height": 900}); wait(200)
    both = js("""const e = S.engine, id = arg[0], list = S.plan.plantings.filter(p => p.cropId === id && follows(p)).map(p => { const r = e.calc(p), y = e.yieldOf(p, r); return { y, parts: e.soldOf(p, r, y) }; });
      return { n: list.length, parts: list.every(x => x.parts.length === 3 && near(x.parts[0].units, x.y.units * 0.7 * 0.8) && near(x.parts[2].units, x.y.units * 0.7 * 0.2 * 0.75) && x.parts[2].unit === 'lb'), left: card().left, cell: card().rows.sharebed.things[arg[1]] };""", [B, b3])
    check("with both kinds on one crop, what is packed from the harvest comes out of what the bed shares leave: the crop itself has 70% × 80%, the second thing 70% × 20% × what one weighs; each share row shows its own figure", both["n"] >= 2 and both["parts"] is True and both["left"]["sharebed"] == 70 and both["left"]["sharepack"] == 80, both)
    check("the cell of a thing packed from the harvest, in the row of bed shares, says where it comes from in plain words: the crop's own share", both["cell"] == f"packed from {nameB}’s own share", both["cell"])

    # ── they travel with the plan ──
    held = js("return { sell: (S.plan.assumptions || {}).sell || {}, n: S.plan.plantings.length, whole: snap().whole, ids: Object.values((S.plan.assumptions || {}).sell || {}).flatMap(l => Object.keys(l.things || {})).sort() };")
    data = {}
    try:
        with page.expect_download(timeout=20000) as dl:
            page.click("#dataBtn"); page.click("#exportBtn")
        saved = os.path.join(str(shots), "plan-with-things.json"); dl.value.save_as(saved); data = json.load(open(saved, encoding="utf-8"))
    except Exception as e: errors.append("download: " + str(e)[:160])
    check("the things are in the file “Download a backup” writes, each under its crop with its own id and every figure", sorted(held["ids"]) == sorted([b1, b3, p1, k1]) and ((data.get("assumptions") or {}).get("sell") or {}) == held["sell"], {"ids": held["ids"]})
    kept = page.evaluate("(async () => { const A = LRFApp; if (!A.snapshotsKept()) return null; const row = await A.snapshot('with the things'); return row ? { id: row.id, name: row.name } : null; })()")
    page.evaluate("(() => { const A = LRFApp; while (A.state.undo.length) A.undo(); })()"); wait(700); bare = snap()
    check("with every step undone the plan is the one the check began with, and its forecast the untouched one: one Undo each, and nothing of a thing is left", bare["plan"] == snap0["plan"] and bare["whole"] == snap0["whole"] and bare["dates"] == snap0["dates"], {"undo": bare["undo"]})
    if kept:
        page.evaluate("id => LRFApp.snapshots().then(s => { const row = s.rows.find(r => r.id === id); return row ? LRFApp.restoreSnapshot(row, { asked: true }) : false; })", kept["id"]); wait(1800)
    back = js("return { sell: (S.plan.assumptions || {}).sell || {}, whole: snap().whole };")
    check("a snapshot holds them, and going back to it brings them back, counted as they were", bool(kept) and back["sell"] == held["sell"] and back["whole"] == held["whole"], {"kept": kept})
    load_backup(); over = js("return { sell: (S.plan.assumptions || {}).sell || {}, counts: Object.keys((S.plan.assumptions || {}).sell || {}).flatMap(id => things(id)).filter(t => t.counts).map(t => t.id).sort(), n: S.plan.plantings.length, sample: A.isSample(), rows: F.build(S.engine).rows.filter(r => r.thing).length };")
    check("a full backup loaded over the plan keeps them, carried with the list, and the window that asks says the list is kept: every thing with its id and its figures, counted in the forecast of the plan that was loaded", "your assumptions list" in (asked[-1] if asked else "") and over["sell"] == held["sell"] and over["counts"] == sorted([b1, b3, p1, k1]) and over["rows"] == 4 and over["n"] > 600 and over["sample"] is False, {"counts": over["counts"], "rows": over["rows"]})

    # ── the build before, given this plan ──
    older = js("""const E0 = window.__before['engine.js'], F0 = window.__before['forecast.js'], bare = JSON.parse(JSON.stringify(S.plan));
      for (const id of Object.keys(bare.assumptions.sell)) { delete bare.assumptions.sell[id].things; if (!Object.keys(bare.assumptions.sell[id]).length) delete bare.assumptions.sell[id]; }
      const a = F0.build(E0.create(S.plan, LRFLibrary)), b = F0.build(E0.create(bare, LRFLibrary)), now = F.build(heldEngine(S.plan, E0.create(S.plan, LRFLibrary)));
      return { same: whole(a) === whole(b), rows: a.rows.filter(r => r.thing).length, differs: whole(a) !== whole(now), things: JSON.stringify(S.plan).includes('"things"'), knew: typeof E0.create(bare, LRFLibrary).thingsOf === 'function' };""")
    check("the build before, its scripts run on this very plan, forecasts it as if no thing had been added: it shows none of them and counts none; or, where it knows things itself, forecasts it exactly as this build does", older["things"] is True and ((older["differs"] is False and older["rows"] > 0) if older["knew"] is True else (older["same"] is True and older["rows"] == 0 and older["differs"] is True)), older)
    check("no error was written to the console", errors == [], errors[:4])
    browser.close()
finish()
