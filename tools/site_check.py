"""The installable site: starts empty, takes a backup, keeps plan and photo, and opens with no connection.
usage: python3 -I site_check.py <site-dir> <backup.zip>
"""
import functools, http.server, json, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

site, backup = Path(sys.argv[1]), sys.argv[2]


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
    out["first"] = js("({sample: A.isSample(), plantings: S.plan.plantings.length, welcome: !!document.querySelector('.welcome'), fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).sort().join(','), manifest: !!document.querySelector('link[rel=manifest]'), privateData: /Seapuit|Osterville/i.test(document.documentElement.innerHTML)})")
    page.set_input_files("#importFile", backup)
    page.wait_for_timeout(3500)
    out["imported"] = js("({plantings: S.plan.plantings.length, attic: S.plan.lrfNext.attic, image: !!(S.plan.lrfNext.mapImage), save: document.getElementById('saveState').textContent, toast: document.querySelector('#toast span').textContent})")
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.wait_for_timeout(1500)
    out["worker"] = page.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))")
    page.reload(); ready(); page.wait_for_timeout(800)
    out["reloaded"] = js("({plantings: S.plan.plantings.length, photo: (document.getElementById('mapPhoto').getAttribute('href') || '').slice(0, 5), shown: document.getElementById('mapPhoto').style.display !== 'none', varieties: S.plan.varieties.length})")
    context.set_offline(True)
    page.reload(); ready(); page.wait_for_timeout(800)
    out["offline"] = js("({plantings: S.plan.plantings.length, photo: (document.getElementById('mapPhoto').getAttribute('href') || '').slice(0, 5), beds: document.querySelectorAll('#mapBeds .bed').length, fonts: [...document.fonts].filter(f => f.status === 'loaded').length})")
    out["export"] = page.evaluate("(async () => { const A = LRFApp; try { const IO = LRFPlanIO; return 'ok'; } catch (e) { return String(e); } })()")
    page.screenshot(path="/home/claude/shots/site-offline.png")
    browser.close()
server.shutdown()
out["errors"] = errors
print(json.dumps(out, indent=1))
