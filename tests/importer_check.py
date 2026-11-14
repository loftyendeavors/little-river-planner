"""The importer's window (preview 0.33) in a real browser: it opens on the link box alone; copying the page's text is offered
only once a link has failed; each failure says which step failed; and nothing is saved by looking.
The sync service is staged: requests to https://sync.example/fetch are answered here, so every failure runs through the real reader.
usage: python3 -I importer_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280
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
KALE = "https://www.johnnyseeds.com/vegetables/kale/zz-test-kale-9999.html"
HTML = '<html><head><title>Zz Importer Test Kale</title><meta property="og:title" content="Zz Importer Test Kale"></head><body><h1>Zz Importer Test Kale</h1><p>55 days to maturity from transplanting.</p></body></html>'
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "x-lrf-key", "access-control-expose-headers": "x-lrf-final-url"}
stage = {"mode": "ok", "asked": 0}
def answer(route):
    req = route.request
    if req.method == "OPTIONS": route.fulfill(status=204, headers=CORS); return
    stage["asked"] += 1
    m = stage["mode"]
    if m == "ok": route.fulfill(status=200, headers={**CORS, "content-type": "text/html; charset=utf-8", "x-lrf-final-url": KALE}, body=HTML)
    elif m == "key": route.fulfill(status=401, headers={**CORS, "content-type": "application/json"}, body='{"error":"no"}')
    elif m == "blocked": route.fulfill(status=403, headers={**CORS, "content-type": "text/html", "x-lrf-final-url": KALE}, body="<html>no</html>")
    elif m == "gone": route.fulfill(status=404, headers={**CORS, "content-type": "text/html", "x-lrf-final-url": KALE}, body="<html>no</html>")
    else: route.abort()
PRE = "const A = LRFApp, S = A.state, $ = id => document.getElementById(id), dlg = () => [...document.querySelectorAll('dialog[open]')].pop(), seen = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;"
SHOW = """const d = dlg(); if (!d) return null; const f = $('sdFallback'), e = $('sdFail');
  return { link: seen(d.querySelector('input[name=url]')), read: [...d.querySelectorAll('button')].filter(seen).map(b => b.textContent.trim()), fallback: seen(f), there: !!f, fail: seen(e) ? e.textContent : '', step: seen(e) ? e.dataset.step : '',
    settings: seen($('sdSettings')), how: ($('sdLinkHow') || {}).dataset ? $('sdLinkHow').dataset.how : null, hint: (d.querySelector('label.fld small') || {}).textContent || '', status: (d.querySelector('.dlg-status') || {}).textContent || '',
    text: [...d.querySelectorAll('h2, h3, p, small, label > span, summary, li, button')].filter(seen).map(x => x.textContent).join(' | '), focus: document.activeElement ? (document.activeElement.name || document.activeElement.id || document.activeElement.tagName) : '', review: !!d.querySelector('#sdSave') };"""
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark")
    page = ctx.new_page(); page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("https://sync.example/**", answer)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup:
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(4500)
    def js(body): return page.evaluate("(() => { " + PRE + body + " })()")
    def wait(ms=350): page.wait_for_timeout(ms)
    def show(): return js(SHOW) or {}
    def open_importer():
        js("A.setView('seeds');"); wait(500)
        if page.locator("#sdAddLink").count(): page.click("#sdAddLink"); wait(400)
    def close_all():
        for _ in range(3):
            if js("return !!dlg()"): page.keyboard.press("Escape"); wait(200)
    def press_read(address=None):
        if address is not None and page.locator('dialog[open] input[name="url"]').count(): page.fill('dialog[open] input[name="url"]', address)
        b = page.locator('dialog[open] button', has_text="Read page")
        if b.count(): b.first.click()
        wait(900)
    def cloud(v): js(f"A.linkService = () => ({{ base: 'https://sync.example', key: 'v1.1234567890.abcdefghijklmnopqrstuvwx', v: {v} }});")
    start = js("return { key: A.contentKey(), n: S.plan.varieties.length, undo: S.undo.length }")

    # ── a device with no way to read a link ──
    open_importer(); a = show()
    check("the window is there, with a link box", bool(a) and a.get("link"))
    check("it opens on the link box, Read page and Cancel, and nothing else", a.get("read") == ["Read page", "Cancel"] and not a.get("fallback") and not a.get("settings") and not a.get("fail"), a)
    check("nothing on it speaks of pasting a page or of a fetch service", "paste the page" not in a.get("text", "").lower() and "copy the page" not in a.get("text", "").lower() and "fetch service of your own" not in a.get("text", "").lower() and "summary" not in a.get("text", ""), a.get("text"))
    check("with no Cloud sync the line under the box says what would make links work, and no more", a.get("hint", "").startswith("Links are read through Cloud sync once this device is connected") and "paste" not in a.get("hint", "").lower() and a.get("how") == "none", a)
    page.screenshot(path=str(shots / f"importer-open-{WIDTH}.png"))
    press_read(""); b = show()
    check("Read page on an empty box asks for the address, and offers nothing else: no read has failed", b.get("step") == "address" and "address first" in b.get("fail", "") and not b.get("fallback"), b)
    press_read(KALE); c = show()
    check("with no way to read links, a press on Read page is a failed read that says what would make links work", c.get("step") == "setup" and "not connected" in c.get("fail", "") and "Backup, Cloud sync" in c.get("fail", "") and stage["asked"] == 0, c)
    check("after the failed read, and only then, copying the page's text is offered under the reason", c.get("fallback") and "Copy the page’s text instead" in c.get("text", "") and "Ctrl" in c.get("text", "") and "Paste it here." in c.get("text", "") and "Type the variety’s name" in c.get("text", "") and "Read pasted page" in c.get("read", []) and js("return [...$('sdFallback').querySelectorAll('ol.sd-steps > li')].length") == 3, c)
    check("the fetch service of his own is inside it, last, and the window still says how links are read", c.get("settings") and c.get("how") == "none" and (c.get("read") or [""])[-1] == "Use a fetch service of your own instead…", c.get("read"))
    check("the box to paste into has the focus", c.get("focus") in ("pasteText", "sdPasteText"), c.get("focus"))
    order = js("const d = dlg(), r = el => el.getBoundingClientRect(); return { fail: r($('sdFail')).top, fb: r($('sdFallback')).top, btn: r([...d.querySelectorAll('button')].find(b => b.textContent === 'Read page')).bottom, wide: d.scrollWidth <= d.clientWidth + 1, clipped: [...d.querySelectorAll('h3, li, label > span, button, p')].filter(seen).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.slice(0, 30)) }")
    check("the reason is under the buttons and above what to do instead, and nothing is clipped", order["btn"] <= order["fail"] and order["fail"] < order["fb"] and order["wide"] and not order["clipped"], order)
    page.screenshot(path=str(shots / f"importer-failed-{WIDTH}.png"))
    # the copied text is read, and coming back from the review finds the window as it was left
    def paste(text, name=None):
        if not (page.locator('dialog[open] textarea[name="pasteText"]').count() and show().get("fallback")): return
        page.fill('dialog[open] textarea[name="pasteText"]', text)
        if name is not None: page.fill('dialog[open] input[name="pasteName"]', name)
        page.locator('dialog[open] button', has_text="Read pasted page").first.click(); wait(900)
    paste("Zz Importer Test Kale\n55 days to maturity from transplanting.\nPacket 100 seeds"); r0 = show()
    check("copied text with no name is not read: it asks for the name, which the text cannot give", not r0.get("review") and "name" in r0.get("status", "") and r0.get("focus") in ("pasteName", "sdPasteName"), r0)
    paste("Zz Importer Test Kale\n55 days to maturity from transplanting.\nPacket 100 seeds", "Zz Importer Test Kale"); r = show()
    check("with the name typed, the copied text is read to the review screen", r.get("review"), r.get("status") or r.get("fail"))
    back0 = page.locator('dialog[open] button', has_text="Back")
    if back0.count(): back0.first.click(); wait(400)
    paste(HTML, ""); r2 = show()
    check("page source carries its own name: read with none typed", r2.get("review"), r2.get("status") or r2.get("fail"))
    close_all()
    check("leaving saves nothing", js("return { key: A.contentKey(), n: S.plan.varieties.length, undo: S.undo.length }") == start)

    # ── the older sync service ──
    cloud(1); open_importer(); o = show(); press_read(KALE); o2 = show()
    check("with the older sync service the window still opens on the link alone, and says what one paste in Cloudflare would do", o.get("read") == ["Read page", "Cancel"] and not o.get("fallback") and "Cloudflare" in o.get("hint", "") and o.get("how") == "cloud-old", o)
    check("and Read page there is a failed read that says so, without asking the service", o2.get("step") == "setup" and "Cloudflare" in o2.get("fail", "") and o2.get("fallback") and stage["asked"] == 0, o2)
    close_all()

    # ── signed in to a sync service that reads links ──
    cloud(2); stage["mode"] = "ok"; open_importer(); g = show()
    check("signed in to Cloud sync it opens on the link alone", g.get("read") == ["Read page", "Cancel"] and not g.get("fallback") and "read through your Cloud sync" in g.get("hint", "") and g.get("how") == "cloud", g)
    press_read(KALE); wait(600); g2 = show()
    check("a link that reads goes straight to the review screen", g2.get("review") and stage["asked"] >= 1, g2.get("fail") or g2.get("status"))
    back = page.locator('dialog[open] button', has_text="Back")
    if back.count(): back.first.click(); wait(400)
    g3 = show()
    check("and coming back from the review, the copied-text route has still never been shown", (not back.count()) or (g3.get("link") and not g3.get("fallback") and not g3.get("fail")), g3)
    close_all()
    def fails(mode, address=KALE):
        stage["mode"] = mode; open_importer(); before = show(); press_read(address); wait(500); out = show(); close_all(); return before, out
    b4, f1 = fails("key")
    check("the service refusing the device: said as not signed in, with where to connect again", f1.get("step") == "signin" and "Backup, Cloud sync" in f1.get("fail", "") and f1.get("fallback") and not b4.get("fallback"), f1)
    b4, f2 = fails("down")
    check("no answer from the service: said as a connection to check", f2.get("step") == "connection" and "online" in f2.get("fail", "") and f2.get("fallback"), f2)
    b4, f3 = fails("blocked")
    check("the supplier refusing the reader: said as the supplier's doing, by name", f3.get("step") == "supplier" and "johnnyseeds.com refused" in f3.get("fail", "") and f3.get("fallback"), f3)
    b4, f4 = fails("gone")
    check("no page at the address: said as a link to check", f4.get("step") == "supplier" and "no page at that address" in f4.get("fail", "") and f4.get("fallback"), f4)
    asked = stage["asked"]; b4, f5 = fails("ok", "https://www.example.com/kale.html")
    check("a site off the supplier list: named, and the service is not asked", f5.get("step") == "list" and "example.com is not on the list" in f5.get("fail", "") and f5.get("fallback") and stage["asked"] == asked, f5)
    b4, f6 = fails("ok", "kale")
    check("something that is not an address: said so, and no copied-text route, since nothing was tried", f6.get("step") == "address" and "not a complete web address" in f6.get("fail", "") and not f6.get("fallback") and stage["asked"] == asked, f6)
    said = " ".join(x.get("fail", "") for x in (c, o2, f1, f2, f3, f4, f5, f6))
    check("no failure speaks of Settings, LRF_SITES or \"paste the page\"", all(w not in said for w in ("Settings", "LRF_", "paste the page", "Paste the page", "Read pasted details")), said)
    check("every failure that offers the copied text points down to it", all(("below" in x.get("fail", "")) for x in (c, o2, f1, f2, f3, f4, f5)))

    # ── a fetch service of his own ──
    stage["mode"] = "down"; open_importer(); press_read(KALE); wait(400)
    if page.locator("#sdSettings").count() and show().get("settings"): page.click("#sdSettings"); wait(400)
    own = js("const d = dlg(); return d ? d.querySelector('h2').textContent : null")
    check("a fetch service of his own can still be set, from inside what a failed link offers", own == "A fetch service of your own", own)
    close_all(); js("delete A.linkService;")
    end = js("return { key: A.contentKey(), n: S.plan.varieties.length, undo: S.undo.length }")
    check("after all of it the plan and the varieties are as they were found", end == start, [start, end])
    check("the page raised no error", not errors, errors[:3])
    finish()
