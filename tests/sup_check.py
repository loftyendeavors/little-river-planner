"""The supplies corrections (preview 0.33) in a real browser: plug trays used once, cases, carrying trays, mix in cubic feet
and bags with round figures he can type over, crates in the mix, and that looking changes nothing.
usage: python3 -I sup_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok: failed.append(name)
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
PRE = "const A = LRFApp, S = A.state, N = LRFNursery, $ = id => document.getElementById(id), row = id => document.querySelector(`#bnSupplies tr[data-supply=\"${id}\"]`), sup = () => N.supplies(S.engine, A.planYear(), (S.plan.lrfNext || {}).supplies || null);"
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark")
    page = ctx.new_page(); page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup:   # the built site carries no plan: load his, as the other site checks do
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(4500)
    def js(body): return page.evaluate("(() => { " + PRE + body + " })()")
    def wait(ms=350): page.wait_for_timeout(ms)
    def typed(sel, value):   # a field a fault has removed is not typed into: the named line after it fails
        if not page.locator(sel).count(): return False
        page.fill(sel, value); page.locator(sel).blur(); wait(); return True
    def undo(): js("A.undo();"); wait()

    check("the build says it is preview 0.39", "0.39" in (js("return ($('buildNote') || {}).textContent || ''") or ""))
    key0 = js("return A.contentKey()")
    js("A.setView('trays'); LRFTraysView.setTab('supplies');"); wait(500)
    check("Supplies is drawn, on the Nursery's own tab", js("return !!$('bnSupplies') && LRFTraysView.tab() === 'supplies'"))
    text = js("return ($('bnSupplies') || {}).textContent || ''") or ""
    low = text.lower()
    check("no quarts anywhere in Supplies", " qt" not in low and "quart" not in low, low[:200])
    check("mix is headed in cubic feet", "Mix each, cu ft" in text and "Mix, cu ft" in text)
    check("the notes say what is used once and what comes back", "used once" in text and "come back" in text and "type your own over it" in text)

    plug = js("return sup().rows.filter(r => /^tray-/.test(r.id)).map(r => ({ id: r.id, need: r.need, fills: r.fills, buy: r.buy, pack: r.pack, cells: row(r.id) ? [...row(r.id).cells].map(c => c.textContent) : null }))") or []
    check("there are plug trays to look at", len(plug) > 0)
    check("a plug tray is used once: needed is every tray filled, and the page shows that figure", bool(plug) and all(p["cells"] and p["need"] == p["fills"] and p["cells"][1].replace(",", "") == str(p["need"]) and "at once" not in p["cells"][2] and "thrown out" in p["cells"][2] for p in plug), plug[:2])
    check("plug trays are bought by the case of 50, rounded up", bool(plug) and all(p["pack"] and p["pack"]["size"] == 50 and p["pack"]["n"] == -(-p["buy"] // 50) and (f'{p["pack"]["n"]} case' in p["cells"][4]) and "of 50" in p["cells"][4] for p in plug), plug[:2])
    wool = js("const r = sup().rows.find(r => r.id === 'rockwool'); return r ? { pack: r.pack, buy: r.buy, cell: row('rockwool') ? row('rockwool').cells[4].textContent : '' } : null")
    check("rockwool is bought by the case of 30", bool(wool) and wool["pack"]["size"] == 30 and wool["pack"]["n"] == -(-wool["buy"] // 30) and "of 30" in wool["cell"], wool)

    first = plug[0]["id"] if plug else "tray-50"
    each = js(f"const i = row('{first}') && row('{first}').querySelector('[data-f=mix]'), r = sup().rows.find(r => r.id === '{first}'); return i ? {{ value: i.value, placeholder: i.placeholder, round: r.mixDefault, own: r.mixOwn, bag: row('{first}').querySelector('.bn-bag') ? row('{first}').querySelector('.bn-bag').textContent : '' }} : null")
    check("a tray starts from a round figure, shown in grey and not as his", bool(each) and each["value"] == "" and each["own"] is False and each["round"] and float(each["placeholder"]) == each["round"], each)
    check("beside the figure is about how many a bag fills", bool(each) and each["bag"].startswith("about ") and each["bag"].endswith(" a bag"), each)
    m0 = js("return sup().mix")
    mixtext = js("return row('mix') ? [...row('mix').cells].map(c => c.textContent) : null")
    check("mix is added up in cubic feet and in bags of 2.8, rounded up", bool(mixtext) and m0["counted"] > 0 and m0["bags"] == -(-m0["need"] // 2.8) and "cu ft" in mixtext[1] and f'{m0["bags"]} bags of 2.8 cu ft' in mixtext[2] and f'{m0["buy"]} bag' in mixtext[4], mixtext)
    check("the mix row says how many crates were counted", m0["crates"]["n"] > 0 and bool(mixtext) and f'{m0["crates"]["n"]} crates counted' in mixtext[2], mixtext)
    page.screenshot(path=str(shots / f"supplies-{WIDTH}.png"), full_page=False)
    fit = js("const t = document.querySelector('#bnSupplies .tr-scroll'), tb = t && t.querySelector('table'); if (!tb) return null; const out = { scroll: t.scrollWidth, client: t.clientWidth, clipped: [] }; for (const el of tb.querySelectorAll('th, td b, small, span')) if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.clipped.push(el.textContent.slice(0, 30)); const r = tb.getBoundingClientRect(), w = document.querySelector('.tr-wrap').getBoundingClientRect(); out.left = r.left - w.left; out.right = w.right - r.right; return out;")
    check("the table fits its place: nothing scrolls sideways and no label is clipped", bool(fit) and fit["scroll"] <= fit["client"] + 1 and not fit["clipped"], fit)
    check("looking has changed nothing", js("return A.contentKey()") == key0)

    # his own figure over the round one
    ok = typed(f'#bnSupplies tr[data-supply="{first}"] [data-f=mix]', "0.25")
    a = js(f"const r = sup().rows.find(r => r.id === '{first}'); return {{ each: r.mixEach, own: r.mixOwn, cuft: r.mixCuFt, fills: r.fills, need: sup().mix.need, shown: row('{first}').querySelector('[data-f=mix]').value, toast: (document.querySelector('.toast') || {{}}).textContent || '' }}")
    check("his own figure is taken over the round one, and said", ok and a["own"] is True and a["each"] == 0.25 and abs(a["cuft"] - a["fills"] * 0.25) < 1e-9 and a["shown"] == "0.25" and abs(a["need"] - (m0["need"] + a["fills"] * (0.25 - each["round"]))) < 1e-6 and "0.25 cu ft of mix each" in a["toast"], a)
    ok = typed(f'#bnSupplies tr[data-supply="{first}"] [data-f=mix]', "")
    b = js(f"const r = sup().rows.find(r => r.id === '{first}'); return {{ each: r.mixEach, own: r.mixOwn, need: sup().mix.need }}")
    check("clearing it goes back to the round figure", ok and b["own"] is False and b["each"] == each["round"] and abs(b["need"] - m0["need"]) < 1e-9, b)
    undo(); undo()
    check("two undos put everything back", js("return A.contentKey()") == key0)
    crate = js("const r = sup().rows.find(r => r.crates); return r ? { id: r.id, cuft: r.mixCuFt, fills: r.fills, need: r.need } : null")
    check("there is a crate row to look at", bool(crate))
    if crate:
        ok = typed(f'#bnSupplies tr[data-supply="{crate["id"]}"] [data-f=mix]', "0")
        c = js(f"const r = sup().rows.find(r => r.id === '{crate['id']}'), m = sup().mix; return {{ each: r.mixEach, cuft: r.mixCuFt, need: m.need, bags: m.bags, crates: m.crates, missing: m.missing }}")
        check("a crate said to take no mix is counted at nothing, and is not listed as wanting a figure", ok and c["each"] == 0 and c["cuft"] == 0 and abs(c["need"] - (m0["need"] - crate["cuft"])) < 1e-6 and c["bags"] < m0["bags"] and not c["missing"], c)
        undo()
    ok = typed('#bnSupplies tr[data-supply="mix"] [data-f=have]', "10")
    d = js("const m = sup().mix; return { have: m.have, buy: m.buy, bags: m.bags, own: (S.plan.lrfNext || {}).supplies, cell: row('mix').cells[4].textContent }")
    check("bags on hand come off the bags to buy", ok and d["have"] == 10 and d["buy"] == m0["bags"] - 10 and d["own"] == {"have": {"bags": 10}} and f'{d["buy"]} bag' in d["cell"], d)
    undo()
    car = js("const r = sup().rows.find(r => r.id === 'carrier'); return r ? { need: r.need, pockets: r.pockets, pick: row('carrier') && row('carrier').querySelector('select[data-f=pockets]') ? row('carrier').querySelector('select[data-f=pockets]').value : null } : null")
    check("pots have a carrying tray row, 15 pots a tray until he says 10", bool(car) and car["pockets"] == 15 and car["pick"] == "15" and car["need"] > 0, car)
    if car and car["pick"]:
        page.select_option('#bnSupplies tr[data-supply="carrier"] select[data-f=pockets]', "10"); wait()
        e = js("const r = sup().rows.find(r => r.id === 'carrier'); return { need: r.need, pockets: r.pockets, own: (S.plan.lrfNext || {}).supplies, room: JSON.stringify(N.roomOf(S.engine.benchList())) }")
        check("a tray of 10 pots is taken at his word, and takes no fewer trays", e["pockets"] == 10 and e["need"] >= car["need"] and e["own"] == {"pockets": 10}, e)
        undo()
    check("at the end the plan is as it was found", js("return A.contentKey()") == key0 and js("return (S.plan.lrfNext || {}).supplies || null") is None)
    check("the page raised no error", not errors, errors[:3])
    finish()
