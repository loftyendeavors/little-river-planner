"""The variety swap (js/swap.js) in a real browser, on the made-up farm: a variety put in the place of another across the plantings
that used it. The way in is on the variety's panel on Seeds; the sheet lists the crop's other varieties with their photographs and
the plantings that would change, each with its harvest's move; nothing changes until the dark button; then one step, one Undo, and
the answer stands in the panel. Each planting keeps its sowing day; an unticked one and an already sown one are untouched; the
sheet's figures are the engine's on the plan after the step; Undo gives back the plan exactly.
A sowing is recorded here first, through the page's own step, so that an already sown planting is there to be left out: the farm
itself carries none, and adding one to it would change what every other check sees.
Every subject is found on the plan the page was given: nothing here names a crop, a variety, a bed or a number of any plan.
usage: python3 -I swap_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280, STOP_AT_FAIL=1
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
# the page's clock: December 1 of the plan's year, so that a sowing planned in the season can be recorded as done
FAKE = "(() => { const R = Date, off = new R(2027, 11, 1, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();"
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, W = LRFSwap, SL = LRFSeedLib, F = LRFForecast, UI = LRFUI, $ = id => document.getElementById(id), eng = S.engine;"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const sowDay = r => r ? r.sow || r.field : null, iso = d => E.validDate(d) ? E.d2s(d) : null, worth = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);"
       "const sheet = () => { const d = hook('swap-sheet'); return d && d.open ? d : null; };"
       "const row = id => hooks('swap-row').find(r => r.dataset.planting === id);")
def js(page, body, arg=None):
    return page.evaluate("(arg) => { %s %s }" % (PRE, body), arg)
def press(page, selector, ms=300):
    """A thing a fault has taken away is not pressed: the named line after it fails, and the check goes on."""
    hit = page.locator(selector)
    if not hit.count() or not hit.first.is_visible(): return False
    hit.first.click(timeout=3000); page.wait_for_timeout(ms); return True
def money(text):
    return [int(x.replace(",", "")) for x in re.findall(r"\$([\d,]+)", text or "")]

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 960}); ctx.add_init_script(FAKE); page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)

    # ── the subject: a variety with four or more plantings the swap takes, one with days of its own, and another of its crop
    # whose days move their harvest. The subject is chosen by the engine's own figures, not by the sheet ──
    pick = js(page, """
      for (const from of S.plan.varieties.filter(v => !v.deleted && v.active !== false)) {
        const mine = S.plan.plantings.filter(p => p.varietyId === from.id && eng.calc(p) && !eng.pinned(p) && !p.done && !p.liveTray && SL.sowing(eng, p));
        if (mine.length < 4 || !S.plan.plantings.some(p => p.varietyId === from.id && eng.pinned(p) && eng.calc(p))) continue;
        for (const to of eng.varietiesOf(from.cropId)) {
          if (to.id === from.id) continue;
          const q = { ...mine[1], varietyId: to.id }, e2 = E.create({ ...S.plan, plantings: S.plan.plantings.map(p => p.id === q.id ? q : p) }, LRFLibrary);
          if (E.dayDiff(e2.calc(q).first, eng.calc(mine[1]).first) && iso(sowDay(e2.calc(q))) === iso(sowDay(eng.calc(mine[1]))))
            return { from: from.id, to: to.id, name: from.name, toName: to.name, sown: mine[0].id, off: mine[2].id, n: S.plan.plantings.filter(p => p.varietyId === from.id && eng.calc(p)).length };
        }
      }
      return null;""")
    check("the plan has a variety with four plantings the swap takes, one with days of its own, and another of its crop with other days, for the check to work on", pick)
    if not pick: finish()
    # prices differ by variety: the new one is given a price of its own through the page's own step, so that the season's worth moves
    priced = page.evaluate("(id) => LRFApp.setSellV(id, { price: 99 }, 'A price of its own')", pick["to"]); page.wait_for_timeout(300)
    check("the new variety is given a price of its own through the page's own step", priced)
    # a sowing recorded through the page's own step, on its planned day
    sown = js(page, "const p = eng.planting(arg), s = SL.sowing(eng, p); const done = A.recordSowing(p.id, { date: E.d2s(s.planned), follow: false }); return { ok: !!done, done: S.engine.planting(p.id).done };", pick["sown"])
    check("a sowing of one of its plantings is recorded through the page's own step", sown["ok"] and sown["done"], sown)
    before = js(page, "return { plan: JSON.stringify(S.plan), key: A.contentKey(), undo: S.undo.length, worth: worth(S.engine), figures: Object.fromEntries(S.plan.plantings.filter(p => p.varietyId === arg).map(p => { const r = S.engine.calc(p); return [p.id, { date: p.date, sow: iso(sowDay(r)), first: iso(r.first) }]; })) };", pick["from"])

    # ── the way in ──
    js(page, "A.setView('seeds'); LRFSeeds.select({ type: 'variety', id: arg }); return null;", pick["from"]); page.wait_for_timeout(800)
    way = js(page, "const b = hook('swap-open'); return { drawn: drawn(b), text: b ? b.textContent : '', inPanel: !!b && !!b.closest('#sdPanel') };")
    check("a variety in the plan, whose crop has another variety, has a way in on its panel on Seeds", way["drawn"] and way["inPanel"] and "place" in way["text"], way)
    page.screenshot(path=str(shots / "panel.png"))
    press(page, '[data-hook="swap-open"]', 500)
    opened = js(page, """const d = sheet(), picks = hooks('swap-pick'), want = eng.varietiesOf(eng.variety(arg).cropId).filter(v => v.id !== arg).map(v => v.id).sort();
      return { open: !!d, picks: picks.map(p => p.dataset.variety).sort(), want, photos: picks.filter(p => p.querySelector('[data-hook="swap-photo"]')).length, head: !!d && !!d.querySelector('header [data-hook="swap-photo"]'),
        rows: hooks('swap-row').length, apply: !!hook('swap-apply') && hook('swap-apply').disabled, width: d ? Math.round(d.getBoundingClientRect().width) : 0 };""", pick["from"])
    check("the sheet opens and offers each other variety of the crop, and no other", opened["open"] and opened["picks"] == opened["want"] and len(opened["want"]) >= 1, opened)
    check("each variety in the sheet is shown with its photograph, the one it replaces too", opened["photos"] == len(opened["picks"]) and opened["head"], opened)
    check("the sheet is 760 wide where there is room, as the design rules give for a sheet", opened["width"] == 760 or WIDTH < 800, opened)
    check("every planting of the variety is listed, and nothing can be put in until a variety is picked", opened["rows"] == pick["n"] and opened["apply"], opened)
    rows0 = js(page, "return hooks('swap-row').map(r => ({ id: r.dataset.planting, state: r.dataset.state, tick: !!r.querySelector('[data-hook=\"swap-tick\"]') && r.querySelector('[data-hook=\"swap-tick\"]').checked, can: !!r.querySelector('[data-hook=\"swap-tick\"]') && !r.querySelector('[data-hook=\"swap-tick\"]').disabled }));")
    sownRow = next((r for r in rows0 if r["id"] == pick["sown"]), None)
    check("the planting already sown is listed as left as it is, and cannot be ticked", sownRow and sownRow["state"] == "sown" and not sownRow["tick"] and not sownRow["can"], sownRow)
    left = js(page, "const l = hook('swap-left'); return { text: l ? l.textContent : '', drawn: drawn(l) };")
    check("a line says the sown planting and those with days of their own are left out", left["drawn"] and "already sown" in left["text"] and "days of" in left["text"], left)
    js(page, "const l = hooks('swap-pick').find(p => p.dataset.variety === arg); if (l) l.click(); return null;", pick["to"]); page.wait_for_timeout(500)
    rows1 = js(page, "return hooks('swap-row').map(r => ({ id: r.dataset.planting, state: r.dataset.state, tick: !!r.querySelector('[data-hook=\"swap-tick\"]') && r.querySelector('[data-hook=\"swap-tick\"]').checked, what: (r.querySelector('[data-hook=\"swap-shift\"]') || {}).textContent || '' }));")
    own = [r for r in rows1 if r["state"] == "own-days"]
    check("a planting with days of its own is unticked, and says it keeps them", own and all(not r["tick"] and "its own days" in r["what"] for r in own), own[:2])
    check("once a variety is picked the planting already sown still cannot be ticked", js(page, "const t = row(arg) && row(arg).querySelector('[data-hook=\"swap-tick\"]'); return !!t && t.disabled && !t.checked;", pick["sown"]))
    check("every other planting the swap can take is ticked once a variety is picked", all(r["tick"] == (r["state"] == "swap") for r in rows1), rows1[:4])
    # untick one, through its own tick
    js(page, "const t = row(arg) && row(arg).querySelector('[data-hook=\"swap-tick\"]'); if (t) t.click(); return null;", pick["off"]); page.wait_for_timeout(400)
    page.screenshot(path=str(shots / "sheet.png"))
    shown = js(page, """const out = {}; for (const r of hooks('swap-row')) out[r.dataset.planting] = { tick: !!r.querySelector('[data-hook="swap-tick"]') && r.querySelector('[data-hook="swap-tick"]').checked, what: (r.querySelector('[data-hook="swap-shift"]') || {}).textContent || '' };
      const t = el => (el || {}).textContent || ''; return { rows: out, worth: t(hook('swap-worth')), seed: t(hook('swap-seed')), count: t(hook('swap-count')), by: t(hook('swap-by')), apply: hook('swap-apply') ? hook('swap-apply').textContent : '', key: A.contentKey(), plan: JSON.stringify(S.plan) };""")
    taken = [i for i, r in shown["rows"].items() if r["tick"]]
    check("an unticked planting stays unticked, and the count and the dark button follow", not shown["rows"].get(pick["off"], {}).get("tick", True) and str(len(taken)) in shown["apply"] and shown["count"].startswith("plantings" ) and (" %d of" % len(taken)) in " " + shown["count"].replace("plantings", ""), {"count": shown["count"], "apply": shown["apply"], "taken": len(taken)})
    check("nothing has changed while the sheet is open: a variety picked and a tick taken off write nothing", shown["key"] == before["key"] and shown["plan"] == before["plan"] and js(page, "return S.undo.length;") == before["undo"])
    check("each ticked planting says how far its harvest moves, with the dates", all(re.search(r"harvest (\d+ days? (later|sooner), \w+ \d+ → \w+ \d+|stays \w+ \d+|ends)", shown["rows"][i]["what"]) for i in taken), [shown["rows"][i]["what"] for i in taken][:3])
    check("the sheet says every sowing day stays", "Every sowing day stays" in shown["by"], shown["by"])
    # Cancel: nothing changes; Escape too
    press(page, '[data-hook="swap-cancel"]', 300)
    check("Cancel closes the sheet and changes nothing", not js(page, "return !!sheet();") and js(page, "return A.contentKey();") == before["key"])
    press(page, '[data-hook="swap-open"]', 500); page.keyboard.press("Escape"); page.wait_for_timeout(300)
    check("Escape closes the sheet and changes nothing", not js(page, "return !!sheet();") and js(page, "return A.contentKey();") == before["key"])
    # again, to the end
    press(page, '[data-hook="swap-open"]', 500)
    js(page, "const l = hooks('swap-pick').find(p => p.dataset.variety === arg); if (l) l.click(); return null;", pick["to"]); page.wait_for_timeout(400)
    js(page, "const t = row(arg) && row(arg).querySelector('[data-hook=\"swap-tick\"]'); if (t && t.checked) t.click(); return null;", pick["off"]); page.wait_for_timeout(400)
    press(page, '[data-hook="swap-apply"]', 800)
    after = js(page, """const out = {}; for (const p of S.plan.plantings) if (arg.ids.includes(p.id)) { const r = S.engine.calc(p); out[p.id] = { v: p.varietyId, date: p.date, sow: iso(sowDay(r)), first: UI.day(r.first), firstIso: iso(r.first) }; }
      const need = SL.required(S.engine).rows.filter(r => r.variety && r.variety.id === arg.to && r.unit === 'seeds').reduce((n, r) => n + r.toSow, 0);
      return { open: !!sheet(), out, worth: worth(S.engine), need, undo: S.undo.length, key: A.contentKey(), others: JSON.stringify(S.plan.plantings.filter(p => !arg.ids.includes(p.id))) };""", {"ids": list(before["figures"].keys()), "to": pick["to"]})
    check("the dark button closes the sheet and makes one step", not after["open"] and after["undo"] == before["undo"] + 1, {"undo": [before["undo"], after["undo"]]})
    check("every ticked planting takes the new variety", all(after["out"][i]["v"] == pick["to"] for i in taken), [after["out"][i]["v"] for i in taken][:3])
    check("every sowing day of a swapped planting is the same after, the stored day byte for byte and the day worked out", all(after["out"][i]["date"] == before["figures"][i]["date"] and after["out"][i]["sow"] == before["figures"][i]["sow"] for i in taken))
    def harvest_said(i):
        m = re.search(r"harvest (\d+) days? (later|sooner), (\w+ \d+) → (\w+ \d+)", shown["rows"][i]["what"])
        if not m: return "stays" in shown["rows"][i]["what"] and after["out"][i]["firstIso"] == before["figures"][i]["first"]
        days = int(m.group(1)) * (1 if m.group(2) == "later" else -1)
        moved = (__import__("datetime").date.fromisoformat(after["out"][i]["firstIso"]) - __import__("datetime").date.fromisoformat(before["figures"][i]["first"])).days
        return m.group(4) == after["out"][i]["first"] and moved == days
    check("each harvest moved by what the sheet said, to the day it said", all(harvest_said(i) for i in taken), {i: [shown["rows"][i]["what"], after["out"][i]["first"]] for i in taken[:3]})
    untouched = [i for i in before["figures"] if i not in taken]
    check("the unticked, the already sown and those with days of their own are untouched", all(after["out"][i]["v"] == pick["from"] and after["out"][i]["date"] == before["figures"][i]["date"] for i in untouched) and pick["off"] in untouched and pick["sown"] in untouched)
    was_others = js(page, "return JSON.stringify(JSON.parse(arg.plan).plantings.filter(p => !arg.ids.includes(p.id)));", {"plan": before["plan"], "ids": list(before["figures"].keys())})
    check("no planting of any other variety changed", after["others"] == was_others)
    w = money(shown["worth"])
    check("the season's worth the sheet gave, before and after, is the engine's", len(w) == 2 and abs(w[1] - after["worth"]) <= 0.5 and abs(w[0] - before["worth"]) <= 0.5 and w[0] != w[1], {"sheet": shown["worth"], "engine": [before["worth"], after["worth"]]})
    s = re.search(r": ([\d,]+) seeds to sow", shown["seed"])
    check("the seed of the new variety the sheet gave is what the plan needs of it after the step", s and int(s.group(1).replace(",", "")) == round(after["need"]), {"sheet": shown["seed"], "plan": after["need"]})
    # ── the answer, where it was asked, with its Undo ──
    said = js(page, "const s = hook('swap-said'); return { drawn: drawn(s), inPanel: !!s && !!s.closest('#sdPanel'), text: s ? s.textContent : '', undo: drawn(hook('swap-undo')), toast: $('toast') ? $('toast').classList.contains('show') && /in place of|planting/.test($('toast').textContent) : false };")
    check("the answer stands in the variety's panel: how many plantings, that the sowing days stay, the season's worth", said["drawn"] and said["inPanel"] and ("%d planting" % len(taken)) in said["text"] and "sowing day" in said["text"] and "$" in said["text"], said)
    check("one answer only: no message over the page as well", not said["toast"], said)
    page.screenshot(path=str(shots / "answer.png"))
    press(page, '[data-hook="swap-undo"]', 700)
    back = js(page, "return { plan: JSON.stringify(S.plan), key: A.contentKey(), undo: S.undo.length, said: drawn(hook('swap-said')) };")
    check("Undo gives back the plan exactly, record for record", back["plan"] == before["plan"] and back["key"] == before["key"] and back["undo"] == before["undo"], {"key": [before["key"], back["key"]]})
    check("after Undo the answer is gone from the panel", not back["said"])
    browser.close()

with sync_playwright() as pw:
    try: run(pw)
    except Exception as e: check("the check ran to its end", False, repr(e)[:600])
check("no error on the page", not [e for e in errors if "pageerror" in e], errors[:4])
finish()
