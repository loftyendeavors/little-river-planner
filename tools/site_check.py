"""The installable site: starts empty, takes a backup, keeps plan and photo, and opens with no connection.
usage: python3 -I site_check.py <site-dir> <backup.zip> [screenshot.png]     env LRF_PRIVATE_WORDS="word|word": words the page must not hold
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

site, backup = Path(sys.argv[1]), sys.argv[2]
# Words that must not be on the page (a place, a name), given from outside so that this file names none: LRF_PRIVATE_WORDS="word|word"
PRIVATE = [w.strip().lower() for w in os.environ.get('LRF_PRIVATE_WORDS', '').split('|') if w.strip()]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(site)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
out, errors = {}, []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1480, "height": 900})
    page = context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    ready = lambda: (page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000), page.wait_for_timeout(700))
    js = lambda expr: page.evaluate(f"(() => {{ const A = LRFApp, S = A.state; return {expr}; }})()")
    page.goto(url); ready()
    out["first"] = js("({sample: A.isSample(), plantings: S.plan.plantings.length, welcome: !!document.querySelector('.welcome'), strip: !document.getElementById('firstRun').hidden && /No plan of yours is in this browser/.test(document.getElementById('firstRun').textContent), fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).sort().join(','), manifest: !!document.querySelector('link[rel=manifest]'), privateData: PRIVATE.some(w => document.documentElement.innerHTML.toLowerCase().includes(w))})".replace('PRIVATE', json.dumps(PRIVATE)))
    page.set_input_files("#importFile", backup)
    page.wait_for_timeout(3500)
    try: page.wait_for_function("LRFThumbs.count() >= 100 && /Saved/.test(document.getElementById('saveState').textContent)", timeout=90000)   # variety photos are read after the plan is shown
    except Exception: pass
    out["photos"] = page.evaluate("({thumbs: LRFThumbs.count(), withPhoto: LRFApp.state.plan.varieties.filter(v => v.photo && v.photo.sha256).length, bytes: JSON.stringify(LRFThumbs.all()).length})")
    out["imported"] = js("({plantings: S.plan.plantings.length, attic: S.plan.lrfNext.attic, image: !!(S.plan.lrfNext.mapImage), stripGone: document.getElementById('firstRun').hidden, save: document.getElementById('saveState').textContent, toast: document.querySelector('#toast span').textContent})")
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.wait_for_timeout(1500)
    out["worker"] = page.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))")
    page.reload(); ready(); page.wait_for_timeout(800)
    out["reloaded"] = js("({plantings: S.plan.plantings.length, photo: (document.getElementById('mapPhoto').getAttribute('href') || '').slice(0, 5), shown: document.getElementById('mapPhoto').style.display !== 'none', varieties: S.plan.varieties.length})")
    context.set_offline(True)
    page.reload(); ready(); page.wait_for_timeout(800)
    out["offline"] = js("({plantings: S.plan.plantings.length, photo: (document.getElementById('mapPhoto').getAttribute('href') || '').slice(0, 5), beds: document.querySelectorAll('#mapBeds .bed').length, fonts: [...document.fonts].filter(f => f.status === 'loaded').length})")
    out["export"] = page.evaluate("(async () => { const A = LRFApp; try { const IO = LRFPlanIO; return 'ok'; } catch (e) { return String(e); } })()")
    page.click('[data-view-btn="seeds"]'); page.wait_for_timeout(500)
    out["seeds_offline"] = page.evaluate("""(async () => { const A = LRFApp, S = A.state, v = S.plan.varieties.find(v => v.url && v.catalogDtm), rec = await A.varietyRecord(v.id);
      const r = LRFReader.readPasted('Days To Maturity\\n55 days\\nDAYS TO MATURITY: From transplanting.', 'https://www.johnnyseeds.com/x-1.html', 'Offline Test');
      await A.loadInventory(); await new Promise(r => setTimeout(r, 400));
      return {thumbs: LRFThumbs.count(), photosShown: document.querySelectorAll('#sdBody .sd-var .thumb img').length, stock: Object.keys(A.stockNow()).length, stockInPlan: !!S.plan.seedInventory, rows: document.querySelectorAll('.sd-var').length, live: S.plan.varieties.filter(v => v.active !== false && !v.deleted).length, need: LRFSeedLib.required(S.engine).rows.length, savedPageText: !!(rec && rec.catalogSourceText), pasted: r.facts.maturity.min, basis: r.facts.maturityBasis}; })()""")
    # stock typed in the list, with the network still off, is kept on this device
    row = js("(() => { const st = LRFApp.stockNow(), r = LRFSeedLib.required(LRFApp.state.engine).rows.find(r => r.variety && r.unit === 'seeds' && r.toSow > 60 && !st[r.key]); return r.variety.id; })()")
    cell = f'.sd-var[data-variety="{row}"] .sd-stock'
    page.fill(cell, "40"); page.dispatch_event(cell, "change"); page.wait_for_timeout(900)
    page.reload(); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(700)
    page.click('[data-view-btn="seeds"]'); page.wait_for_timeout(500)
    out["stock_kept_offline"] = js(f"({{onHand: (LRFApp.stockNow()['v:{row}|seeds'] || {{}}).onHand, shown: document.querySelector('.sd-var[data-variety=\"{row}\"] .sd-stock').value, save: document.getElementById('saveState').textContent}})")
    # vendor sizes come from the backup's own lists; a sowing recorded with the network still off draws that lot down
    out["sizes_offline"] = js("({sized: [...document.querySelectorAll('#sdBody td.sd-size')].filter(td => / × /.test(td.textContent)).length, shippedLists: Object.keys(S.packsBase).length})")
    page.locator(f'.sd-var[data-variety="{row}"] td').first.click(); page.wait_for_selector("#sdPanel .sd-sowbtn")
    page.locator("#sdPanel .sd-sowbtn").first.click(); page.wait_for_selector("#sdPanel .sow")
    used = page.evaluate("+document.querySelector('#sdPanel [data-sow=\"quantity\"]').value")
    page.click('#sdPanel [data-sow="record"]'); page.wait_for_timeout(1200)
    page.reload(); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(700)
    out["sowing_kept_offline"] = js(f"(() => {{ const p = S.plan.plantings.find(p => p.done && p.workflow && p.workflow.seedUse), lot = S.plan.seedInventory.lots.find(l => l.key === 'v:{row}' && !l.deleted); return {{used: {used}, offStock: p ? p.workflow.seedUse.filter(u => u.lotId).reduce((n, u) => n + u.quantity, 0) : null, lotNow: lot.quantity, useLines: S.plan.seedInventory.adjustments.filter(a => a.kind === 'use').length}}; }})()")
    if len(sys.argv) > 3:
        page.screenshot(path=sys.argv[3])
    browser.close()
server.shutdown()
out["errors"] = errors
print(json.dumps(out, indent=1))
print(json.dumps({"no-plan strip at first sight": out["first"].get("strip"), "gone once a plan is loaded": out["imported"].get("stripGone"), "errors": len(errors)}))
