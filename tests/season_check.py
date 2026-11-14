"""Preview 0.37 in a real browser: "Season…" on the season bar, the window that changes the farm's five dates, and what a
change does shown before anything is changed. Every figure the window says is held against engines made in the page.
usage: python3 -I season_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
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
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, FD = LRFFarmDates, $ = id => document.getElementById(id), eng = S.engine, txt = id => ($(id) || {}).textContent || '';"
       "const worthOf = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0), money = n => '$' + Math.round(n).toLocaleString('en-US');"
       "const sig = (e, p) => { const r = e.calc(p); if (!r) return null; const y = e.yieldOf(p); return { last: E.d2s(r.last), held: String(+e.occupancyThrough(p, r)), days: [E.d2s(r.sow), E.d2s(r.field), E.d2s(r.first)].join(), units: y ? +y.units || 0 : 0, why: LRFSuccession.seasonTrouble(e, p, r) }; };"
       # an independent reading of what a change of dates does: engines made here, compared planting by planting
       "const found = change => { const e2 = E.create({ ...S.plan, settings: { ...S.plan.settings, ...change } }, LRFLibrary), out = { harvest: 0, days: 0, yields: 0, outside: 0, inside: 0, ids: new Set(), crops: new Set() };"
       " for (const p of S.plan.plantings) { const a = sig(eng, p), b = sig(e2, p); if (!a || !b) continue; if (a.last !== b.last || a.held !== b.held) { out.harvest++; out.ids.add(p.id); out.crops.add(p.cropId); } if (a.days !== b.days) { out.days++; out.ids.add(p.id); } if (Math.abs(a.units - b.units) > 1e-6) { out.yields++; out.ids.add(p.id); } if (!a.why && b.why) out.outside++; if (a.why && !b.why) out.inside++; }"
       " return { harvest: out.harvest, days: out.days, yields: out.yields, outside: out.outside, inside: out.inside, changed: out.ids.size, crops: out.crops.size, worth: [worthOf(eng), worthOf(e2)] }; };"
       "const num = id => { const el = $(id); return el ? +el.querySelector('b').textContent.replace(/[^0-9.-]/g, '') : null; };"
       "const fits = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5; };"
       "const win = () => { const d = $('seasonDlg'); if (!d || !d.open) return null; const v = {}; for (const i of d.querySelectorAll('input[type=date]')) v[i.dataset.key] = i.value;"
       " return { values: v, state: $('fdSum').dataset.state, head: txt('fdHead'), apply: !$('fdApply').disabled, reset: !$('fdReset').disabled, was: [...d.querySelectorAll('.fd-was')].map(x => x.textContent).filter(Boolean), changed: [...d.querySelectorAll('.fd-row[data-changed=true]')].map(x => x.dataset.key), invalid: [...d.querySelectorAll('input[aria-invalid=true]')].map(x => x.dataset.key), text: $('fdSum').innerText }; };"
       "const frost = () => [...document.querySelectorAll('#seasonMarks .season-frost')].map(x => ({ title: x.title, left: x.style.left }));"
       "const snap = () => ({ key: A.contentKey(), settings: JSON.stringify(S.plan.settings), plantings: JSON.stringify(S.plan.plantings).length, undo: S.undo.length });")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark" if DARK else "light")
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
        def startswith(self, x): return False
        def __str__(self): return "(not there)"
    def js(body):
        try:
            got = page.evaluate("(() => { " + PRE + " " + body + " })()")
        except Exception as e:
            errors_seen.append(str(e)[:160]); return Missing()
        return Missing() if got is None and body.strip().startswith("return {") else got
    errors_seen = []
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0
    def click(sel, ms=350):   # a thing a fault has removed is not clicked: the named line after it fails, and the check goes on
        if not has(sel) or not page.locator(sel).first.is_visible(): wait(100); return False
        try:
            page.locator(sel).first.click(timeout=4000)
        except Exception:
            return False
        wait(ms); return True
    def setdate(key, md, ms=500):
        """Type a day into one of the window's five fields, as a hand would: the field is filled and left."""
        sel = f"#fd-{key}"
        if not has(sel): wait(100); return False
        page.fill(sel, f"{year}-{md}" if md else ""); page.dispatch_event(sel, "change"); wait(ms); return True
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    def openwin():
        if js("return !!($('seasonDlg') && $('seasonDlg').open)") is True: return True
        return bool(click("#seasonEdit", 400) and js("return !!($('seasonDlg') && $('seasonDlg').open)") is True)
    def closewin():
        if js("return !!($('seasonDlg') && $('seasonDlg').open)") is True: page.keyboard.press("Escape"); wait(250)
        if js("return !!$('seasonDlg')") is True: page.evaluate("LRFSeason.closeDates()"); wait(150)   # a fault may have taken Escape away: the check still has to go on

    start = js("return { n: S.plan.plantings.length, undo: S.undo.length, label: txt('buildNote'), dates: FD.read(eng), sample: A.isSample() }")
    year = start["dates"]["year"]; D = start["dates"]["dates"]
    check("a plan is open, there is nothing to undo, and the build says 0.39", start["n"] > 300 and start["undo"] == 0 and "0.39" in start["label"] and not start["sample"], start)
    snap0 = js("return snap()"); frost0 = js("return frost()")
    def md(key, n): return page.evaluate("([y, md, n]) => LRFEngine.d2s(LRFEngine.addDays(LRFEngine.s2d(y + '-' + md), n)).slice(5)", [year, D[key], n])
    def word(m): return page.evaluate("m => LRFFarmDates.word(m)", m)

    # ── the season bar ──
    bar = js("""const b = $('seasonEdit'), foot = document.querySelector('footer.season'), peak = $('seasonPeak'), fr = foot.getBoundingClientRect(), group = document.querySelector('.season-date');
      const kids = [...group.children].filter(k => k.offsetParent).map(k => k.getBoundingClientRect());
      return { there: !!b, text: b ? b.textContent : '', tag: b ? b.tagName : '', inFoot: !!b && foot.contains(b), fits: fits(b), clipped: !!b && b.scrollWidth > b.clientWidth + 1, title: b ? b.title : '',
        peakShown: getComputedStyle(peak).visibility !== 'hidden' && peak.offsetParent !== null, peakCut: getComputedStyle(peak).visibility !== 'hidden' && peak.offsetParent !== null && (peak.scrollWidth > peak.clientWidth + 1 || [...peak.children].some(c => c.offsetParent && (c.getBoundingClientRect().right > fr.right + 0.5 || c.scrollWidth > c.clientWidth + 1))), peakWords: [...peak.children].filter(c => c.offsetParent).map(c => c.textContent.trim()),
        peakTitle: peak.title, inside: kids.every(k => k.left >= fr.left - 0.5 && k.right <= fr.right + 0.5), overlap: kids.some((k, i) => i && k.left < kids[i - 1].right - 0.5), frost: frost(), sideways: document.documentElement.scrollWidth > innerWidth, mode: foot.className };""")
    check("“Season…” is a button on the season bar, beside the frost marks it changes", bar["there"] and bar["tag"] == "BUTTON" and bar["text"] == "Season…" and bar["inFoot"] and "frost" in bar["title"].lower(), bar)
    check("it fits there: not clipped, nothing on the bar pushed off it or onto its neighbour, the page not made to scroll sideways", bar["fits"] and not bar["clipped"] and bar["inside"] and not bar["overlap"] and not bar["sideways"], bar)
    check("the peak beside it is never cut off: it is whole, or shortened, and says the whole of it when pointed at", not bar["peakCut"] and "Peak" in bar["peakTitle"] and "week of" in bar["peakTitle"], bar)
    check("both frosts are marked on the bar, with their days", len(bar["frost"]) == 2 and word(D["frostLast"]) in bar["frost"][0]["title"] and word(D["frostFirst"]) in bar["frost"][1]["title"], bar["frost"])
    shot("bar")
    page.evaluate("LRFApp.setView('timeline')"); wait(400)
    check("it is on the Timeline's season bar too", js("return fits($('seasonEdit'))"))
    seen = {}
    for view in ("harvest", "assume", "seeds", "sow", "trays"):
        page.evaluate("v => LRFApp.setView(v)", view); wait(250); seen[view] = js("return !!($('seasonEdit') && $('seasonEdit').offsetParent)")
    check("and on no view that has no season bar", not any(seen.values()), seen)
    page.evaluate("LRFApp.setView('map')"); wait(400)

    # ── the window opens on the plan's own dates, and changes nothing ──
    opened = openwin(); w = js("return win()") or {}
    check("a press opens the window", opened and bool(w))
    check("it shows the plan's five dates, each in a field with a calendar", w.get("values") == {k: f"{year}-{D[k]}" for k in D} and js("return [...document.querySelectorAll('#seasonDlg input[type=date]')].every(i => i.min === S.plan.settings.year + '-01-01' && i.max === S.plan.settings.year + '-12-31')"), w.get("values"))
    lay = js("""const d = $('seasonDlg'), r = d.getBoundingClientRect(); const rows = [...d.querySelectorAll('.fd-row')].map(x => ({ key: x.dataset.key, label: x.querySelector('label').textContent, does: x.querySelector('.fd-does').textContent, cut: [...x.querySelectorAll('label, .fd-does, .fd-was')].some(e => e.scrollWidth > e.clientWidth + 1), out: [...x.children].some(e => e.getBoundingClientRect().right > r.right - 1 || e.getBoundingClientRect().left < r.left) }));
      return { fits: fits(d), rows, groups: [...d.querySelectorAll('.fd-group h3')].map(x => x.textContent), h2: d.querySelector('h2').textContent, lead: d.querySelector('.dlg-lead').textContent, x: !!$('fdClose'), focusIn: d.contains(document.activeElement), wide: d.scrollWidth > d.clientWidth + 1 };""")
    check("the window fits the screen, and no label, date or sentence in it is cut off", lay["fits"] and not lay["wide"] and len(lay["rows"]) == 5 and not any(r["cut"] or r["out"] for r in lay["rows"]), lay)
    check("the dates are named in a grower's words, in two groups, each with what it does", lay["groups"] == ["Frost", "Planting in open ground"] and [r["label"] for r in lay["rows"]] == ["Last spring frost", "First fall frost", "Cool-season crops, from", "Warm-season crops, from", "Outdoor planting ends"] and all(len(r["does"]) > 30 for r in lay["rows"]) and str(year) in lay["h2"] and "Nothing changes until you press Apply" in lay["lead"], lay)
    check("it opens on something to read, not a blank or a complaint: nothing is changed, and Apply is off", w.get("state") == "idle" and w.get("head") == "Nothing is changed" and not w.get("apply") and not w.get("reset") and not w.get("was") and "before anything is changed" in w.get("text", ""), w)
    shot("open")
    page.keyboard.press("Escape"); wait(250)
    check("Escape leaves it and changes nothing", js("return !$('seasonDlg')") and js("return snap()") == snap0)
    openwin(); setdate("frostFirst", md("frostFirst", -15)); click("#fdClose", 250)
    check("so does the ×, with a date typed and not applied", js("return !$('seasonDlg')") and js("return snap()") == snap0 and js("return frost()") == frost0)
    openwin(); w = js("return win()") or {}
    check("opened again, it shows the plan's dates, not what was typed and left", w.get("values", {}).get("frostFirst") == f"{year}-{D['frostFirst']}" and w.get("state") == "idle", w.get("values"))
    setdate("firstWarmField", md("firstWarmField", 5)); click("#fdCancel", 250)
    check("Cancel leaves it the same way", js("return !$('seasonDlg')") and js("return snap()") == snap0)

    # ── the first fall frost, fifteen days sooner: said first ──
    sooner = md("frostFirst", -15)
    openwin(); setdate("frostFirst", sooner)
    w = js("return win()") or {}; f = js("return found({ frostFirst: '%s' })" % sooner)
    said = js("return { harvest: num('fdHarvestN'), yields: num('fdYieldN'), fresh: num('fdFreshN'), worth: txt('fdWorth'), lines: [...document.querySelectorAll('#fdHarvest li')].map(x => x.textContent), fine: (document.querySelector('#fdSum .fd-fine') || {}).textContent || '' }")
    check("a subject: on this plan an earlier frost ends some harvests sooner", f["harvest"] > 0, f)
    check("the window says how many plantings would change, and it is the number an independent reading finds", w.get("state") == "moves" and w.get("head") == f"{f['changed']} planting{'' if f['changed'] == 1 else 's'} would change", [w.get("head"), f])
    check("its figures are that reading's: harvest ends moved, yields changed", said["harvest"] == f["harvest"] and said["yields"] == f["yields"] and said["fresh"] == 0, [said, f])
    check("the harvests that move are listed crop by crop, with how far", len(said["lines"]) == min(f["crops"], 8) + (1 if f["crops"] > 8 else 0) and all("sooner" in x for x in said["lines"][:f["crops"]]) and any("15 days sooner" in x for x in said["lines"]), said["lines"])
    check("the season's worth is said, before and after where it moves", (js("return money(%r)" % f["worth"][0]) in said["worth"]) and ((abs(f["worth"][1] - f["worth"][0]) < 0.5) or js("return money(%r)" % f["worth"][1]) in said["worth"]), [said["worth"], f["worth"]])
    check("the changed date is marked, with what it was", w.get("changed") == ["frostFirst"] and w.get("was") == [f"was {word(D['frostFirst'])}"] and w.get("apply") and w.get("reset"), w)
    check("it says that only the date is written, and that setting it back puts everything back", "Only the date is written" in said["fine"] and "puts everything back" in said["fine"] and "one undo" in said["fine"], said["fine"])
    check("and nothing has changed yet: the plan, its dates, the frost mark on the bar, the undo list", js("return snap()") == snap0 and js("return frost()") == frost0)
    lay2 = js("const d = $('seasonDlg'); return { fits: fits(d), apply: fits($('fdApply')), cancel: fits($('fdCancel')), cut: [...d.querySelectorAll('#fdSum li, #fdSum p, #fdSum b, .au-figs span')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 40)) }")
    check("with the list in it the window still fits, nothing in the list is cut off, and Apply and Cancel are in view", lay2["fits"] and lay2["apply"] and lay2["cancel"] and not lay2["cut"], lay2)
    shot("frost-sooner")

    # a frost early enough to cost yield: the yields and the worth are said
    setdate("frostFirst", "08-01"); fe = js("return found({ frostFirst: '08-01' })")
    said2 = js("return { yields: num('fdYieldN'), harvest: num('fdHarvestN'), worth: txt('fdWorth'), was: money(%r), now: money(%r), head: txt('fdHead'), marked: $('fdWorth').classList.contains('bad') }" % (fe["worth"][0], fe["worth"][1]))
    check("a subject: on this plan a frost on Aug 1 costs yield and worth", fe["yields"] > 0 and fe["worth"][1] < fe["worth"][0] - 1, fe)
    check("then the yields that change are counted, and the season's worth is said before and after, marked as moved", said2["yields"] == fe["yields"] and said2["harvest"] == fe["harvest"] and said2["was"] in said2["worth"] and said2["now"] in said2["worth"] and "→" in said2["worth"] and said2["marked"] and said2["head"].startswith(str(fe["changed"]) + " planting"), [said2, fe])
    check("and still nothing has changed", js("return snap()") == snap0)

    # ── back to the plan's dates ──
    click("#fdReset", 400); w = js("return win()") or {}
    check("“Back to the plan’s dates” puts the five fields back and the window says nothing is changed", w.get("values") == {k: f"{year}-{D[k]}" for k in D} and w.get("state") == "idle" and not w.get("apply") and not w.get("reset") and not w.get("was"), w)

    # ── dates that cannot stand ──
    setdate("frostFirst", md("frostLast", -10)); w = js("return win()") or {}
    check("a first fall frost before the last spring frost is refused in words, in the warning colour, and Apply is off", w.get("state") == "refused" and w.get("head") == "These dates cannot stand" and "after the last spring frost" in w.get("text", "") and not w.get("apply") and w.get("invalid") == ["frostFirst"] and js("return getComputedStyle($('fdErrors')).color === getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() || getComputedStyle($('fdErrors')).color !== getComputedStyle($('fdSum')).color"), w)
    shot("refused")
    refused = js("return A.setFarmDates({ ...FD.read(eng).dates, frostFirst: '%s' })" % md("frostLast", -10))
    check("the app refuses the same dates if asked directly, and changes nothing", refused is False and js("return snap()") == snap0)
    setdate("frostFirst", ""); w = js("return win()") or {}
    check("a field left empty is refused by name", w.get("state") == "refused" and "day of the year is needed for the first fall frost" in w.get("text", "") and not w.get("apply"), w)
    click("#fdReset", 300)
    setdate("lastOutdoorField", md("firstWarmField", -3)); w = js("return win()") or {}
    check("outdoor planting ending before field planting starts is refused", w.get("state") == "refused" and "Outdoor planting has to end after field planting starts" in w.get("text", "") and not w.get("apply"), w)
    click("#fdReset", 300)

    # ── Apply: the first fall frost ──
    setdate("frostFirst", sooner)
    subject = js("const e2 = E.create({ ...S.plan, settings: { ...S.plan.settings, frostFirst: '%s' } }, LRFLibrary); const p = S.plan.plantings.find(p => { const a = eng.calc(p), b = e2.calc(p); return a && b && E.d2s(a.last) !== E.d2s(b.last); }); return p ? { id: p.id, was: E.d2s(eng.calc(p).last), now: E.d2s(e2.calc(p).last) } : null;" % sooner)
    click("#fdApply", 700)
    after = js("return { open: !!$('seasonDlg'), toast: txt('toast'), undoBtn: !!document.querySelector('#toast .toast-action'), frostFirst: S.plan.settings.frostFirst, undo: S.undo.length, last: A.lastChange(), frost: frost(), last2: %s, key: A.contentKey(), save: ($('saveState') || {}).dataset ? $('saveState').dataset.state : '' }" % ("E.d2s(eng.calc(eng.planting('%s')).last)" % subject["id"] if subject else "null"))
    check("Apply closes the window and writes the date", not after["open"] and after["frostFirst"] == sooner, after)
    diff = js("const was = JSON.parse(%r), now = S.plan.settings; return { keys: Object.keys(now).filter(k => JSON.stringify(now[k]) !== JSON.stringify(was[k])), gone: Object.keys(was).filter(k => !(k in now)), plantings: JSON.stringify(S.plan.plantings).length }" % snap0["settings"])
    check("that one line of the settings is all that is written: no planting is touched", diff["keys"] == ["frostFirst"] and not diff["gone"] and diff["plantings"] == snap0["plantings"], diff)
    check("it is one step, said at the time: which date, how many harvests end on another day, and Undo", after["undo"] == snap0["undo"] + 1 and f"Set the first fall frost to {word(sooner)}" in after["toast"] and (f"{f['harvest']} plantings’ harvests end on another day" in after["toast"] or f"{f['harvest']} planting’s harvest ends on another day" in after["toast"]) and after["undoBtn"] and after["last"]["label"] == f"Set the first fall frost to {word(sooner)}", after)
    check("the plan is worked out from the new date at once: the frost mark on the bar has moved, and a harvest the window listed ends on the day it said", bool(subject) and after["last2"] == subject["now"] and after["frost"][1]["left"] != frost0[1]["left"] and word(sooner) in after["frost"][1]["title"] and after["frost"][0] == frost0[0] and after["key"] != snap0["key"], [subject, after["last2"], after["frost"]])
    page.evaluate("LRFApp.setView('timeline')"); wait(500)
    check("the Timeline shows it without a reload", js("return fits($('seasonEdit')) && frost()[1].title.includes('%s')" % word(sooner)))
    page.evaluate("LRFApp.setView('map')"); wait(300)
    openwin(); w = js("return win()") or {}
    check("opened again, the window stands on the new date and says nothing is changed", w.get("values", {}).get("frostFirst") == f"{year}-{sooner}" and w.get("state") == "idle", w.get("values"))
    closewin()
    page.evaluate("LRFApp.undo()"); wait(400)
    check("one Undo puts everything back: the plan reads as it did, and the mark is where it was", js("return snap().key") == snap0["key"] and js("return snap().settings") == snap0["settings"] and js("return frost()") == frost0)
    page.evaluate("LRFApp.redo()"); wait(300); redone = js("return S.plan.settings.frostFirst")
    back = js("return A.setFarmDates({ ...FD.read(eng).dates, frostFirst: '%s' }) && true" % D["frostFirst"]); wait(300)
    check("so does setting the date back by hand: the plan reads the same, word for word", redone == sooner and back is True and js("return snap().key") == snap0["key"] and js("return snap().settings") == snap0["settings"], [redone, back])
    for _ in range(12):
        if not (js("return S.undo.length") > snap0["undo"]): break
        page.evaluate("LRFApp.undo()"); wait(120)

    # ── a field date: no planting changes, some stand outside ──
    later = md("firstWarmField", 19)
    openwin(); setdate("firstWarmField", later); w = js("return win()") or {}; f2 = js("return found({ firstWarmField: '%s' })" % later)
    out = js("return { say: txt('fdOutsideSay'), lines: [...document.querySelectorAll('#fdOutside li')].map(x => x.textContent), same: txt('fdSameSay'), harvest: num('fdHarvestN'), iso: /\\d{4}-\\d{2}-\\d{2}/.test($('fdSum').innerText) }")
    check("a subject: on this plan a later start for warm-season crops leaves some plantings before it", f2["outside"] > 0 and f2["changed"] == 0, f2)
    check("a later start for warm-season crops changes no planting, and the window says so", w.get("head") == "No planting in the plan would change" and out["harvest"] == 0 and w.get("apply"), [w.get("head"), out])
    check("it says how many plantings would stand outside the dates (the number an independent reading finds), that they stay where they are, and that nothing is flagged", f"{f2['outside']} planting{'' if f2['outside'] == 1 else 's'} would stand outside these dates" in out["say"] and ("They stay where they are" in out["say"] or "It stays where it is" in out["say"]) and "flags nothing" in out["say"], [out["say"], f2])
    check("they are listed by crop with the rule that puts them outside, days said as a grower reads them", len(out["lines"]) > 0 and any(f"Warm-season field planting starts {word(later)}" in x for x in out["lines"]) and not out["iso"], out["lines"][:3])
    shot("field-later")
    click("#fdApply", 600)
    a2 = js("return { open: !!$('seasonDlg'), set: S.plan.settings.firstWarmField, toast: txt('toast'), moved: found({}).harvest, badge: txt('settleBadge') }")
    moved = js("const was = E.create({ ...S.plan, settings: JSON.parse(%r) }, LRFLibrary); let n = 0; for (const p of S.plan.plantings) { const a = was.calc(p), b = eng.calc(p); if (a && b && (E.d2s(a.last) !== E.d2s(b.last) || E.d2s(a.field) !== E.d2s(b.field) || E.d2s(a.first) !== E.d2s(b.first) || E.d2s(a.sow) !== E.d2s(b.sow))) n++; } return n;" % snap0["settings"])
    check("applied, the date is set, no planting has moved a day, and the toast says no planting's dates change", not a2["open"] and a2["set"] == later and moved == 0 and "no planting’s dates change" in a2["toast"] and f"Set the start of warm-season field planting to {word(later)}" in a2["toast"], [a2, moved])
    page.evaluate("LRFApp.undo()"); wait(300)

    # ── several dates at once ──
    openwin(); setdate("firstCoolField", md("firstCoolField", -10)); setdate("lastOutdoorField", md("lastOutdoorField", 10)); setdate("frostFirst", md("frostFirst", 7)); w = js("return win()") or {}
    f3 = js("return found({ firstCoolField: '%s', lastOutdoorField: '%s', frostFirst: '%s' })" % (md("firstCoolField", -10), md("lastOutdoorField", 10), md("frostFirst", 7)))
    check("three dates changed together are worked out together", sorted(w.get("changed", [])) == ["firstCoolField", "frostFirst", "lastOutdoorField"] and len(w.get("was", [])) == 3 and w.get("head") == (f"{f3['changed']} planting{'' if f3['changed'] == 1 else 's'} would change" if f3["changed"] else "No planting in the plan would change") and "Only the dates are written" in w.get("text", ""), [w, f3])
    click("#fdApply", 600)
    a3 = js("return { toast: txt('toast'), undo: S.undo.length, label: (A.lastChange() || {}).label }")
    check("and applied as one step, with one name and one Undo", a3["undo"] == snap0["undo"] + 1 and a3["label"] == "Change 3 of the farm’s dates" and "Change 3 of the farm’s dates" in a3["toast"], a3)
    page.evaluate("LRFApp.undo()"); wait(300)
    check("that Undo takes all three back", js("return snap().key") == snap0["key"] and js("return snap().settings") == snap0["settings"])

    # ── a short window, and the layout ──
    page.set_viewport_size({"width": WIDTH, "height": 620}); wait(300)
    openwin(); setdate("frostFirst", md("frostFirst", -60)); setdate("firstWarmField", md("firstWarmField", 19))
    low = js("const d = $('seasonDlg'); return { fits: fits(d), apply: fits($('fdApply')), cancel: fits($('fdCancel')), scrolls: d.scrollHeight > d.clientHeight + 1, top: document.elementFromPoint($('fdApply').getBoundingClientRect().left + 5, $('fdApply').getBoundingClientRect().top + 5) === $('fdApply') }")
    check("on a screen 620 high, with a long list, the window scrolls inside itself and Apply and Cancel stay in view and can be pressed", low["fits"] and low["apply"] and low["cancel"] and low["scrolls"] and low["top"], low)
    shot("short")
    closewin(); page.set_viewport_size({"width": WIDTH, "height": 900}); wait(300)
    page.evaluate("LRFMapEdit.open({})"); wait(500)
    inlay = openwin(); onl = js("return { layout: LRFMapEdit.on(), open: !!$('seasonDlg') }"); closewin()
    check("while the layout is being edited the window still opens, and closing it leaves the layout as it was", inlay and onl["layout"] and onl["open"] and js("return LRFMapEdit.on()") and js("return snap()") == snap0, onl)
    page.evaluate("LRFMapEdit.close()"); wait(300)

    # ── a phone has no season bar ──
    page.set_viewport_size({"width": 390, "height": 800}); wait(600)
    check("on a phone there is no season bar and so no “Season…”", js("return document.body.classList.contains('phone') && !($('seasonEdit') && $('seasonEdit').offsetParent)"))
    page.set_viewport_size({"width": WIDTH, "height": 900}); wait(600)

    end = js("return snap()")
    check("at the end the plan is the one he started with, word for word, with nothing left to undo that was not there", end["key"] == snap0["key"] and end["settings"] == snap0["settings"] and end["plantings"] == snap0["plantings"], [end["undo"], snap0["undo"]])
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
