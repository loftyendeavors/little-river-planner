"""The plan folder in a real browser. No folder window can be clicked in a test, so the browser's own private file
system stands in for the folder the user would choose: it is the same kind of handle, written the same way.
usage: python3 -I folder_check.py <app-dir> <shots-dir>
"""
import functools, http.server, json, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
app, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(app)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok: failed.append(name)
    if '--trace' in sys.argv: print(('ok   ' if ok else 'FAIL ') + name[:90], file=sys.stderr, flush=True)
HELP = """
  const A = LRFApp, S = A.state, F = LRFFolder;
  const dirOf = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Farm plan', { create: true });
  const readPlan = async () => { try { const d = await dirOf(), f = await (await d.getFileHandle('little-river-plan.json')).getFile(); return { text: await f.text(), modified: f.lastModified }; } catch (e) { return null; } };
  const names = async sub => { let d = await dirOf(); if (sub) { try { d = await d.getDirectoryHandle(sub); } catch (e) { return []; } } const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort(); };
  const put = async text => { const d = await dirOf(), w = await (await d.getFileHandle('little-river-plan.json', { create: true })).createWritable(); await w.write(text); await w.close(); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
"""
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}); page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text else None)
    js = lambda body: page.evaluate("(async () => { " + HELP + " " + body + " })()")
    ready = lambda: (page.wait_for_function("window.LRFApp && LRFApp.state.ready"), page.wait_for_timeout(900))
    page.goto(url); ready()

    before = js("return { supported: F.supported(), info: F.info(), status: document.getElementById('saveState').textContent, menu: document.getElementById('folderMenu').textContent, note: document.getElementById('saveNowNote').textContent };")
    check("with no folder the plan is kept in the browser, Save now downloads a file, and the menu offers a folder", not before["info"]["connected"] and "Saved on this device" in before["status"] and "Downloads a backup file" in before["note"] and (not before["supported"] or "Keep the plan in a folder" in before["menu"]), before)

    # the folder is chosen: the plan goes into it at once, and again after every change
    first = js("const f = await F.use(await dirOf(), { keep: false }); const done = await A.saveToFolder(); const file = await readPlan(), plan = JSON.parse(file.text); return { f, done, plantings: plan.plantings.length, mine: S.plan.plantings.length, own: plan.lrfNextKeep, device: F.device(), files: await names(), status: document.getElementById('saveState').textContent, same: JSON.stringify(plan.plantings) === JSON.stringify(S.plan.plantings) };")
    check("a folder with no plan in it takes the whole plan: every planting, who saved it and when", first["f"]["connected"] and not first["f"]["conflict"] and first["done"].get("saved") and first["plantings"] == first["mine"] and first["same"] and first["own"]["device"] == first["device"] and first["own"]["savedAt"] == first["done"]["savedAt"], {k: first[k] for k in ("f", "done", "plantings", "mine", "files")})
    check("the small variety photos go into the folder too, and the indicator names the folder", "thumbnails.json" in first["files"] and first["status"].startswith("Saved · Farm plan"), {"files": first["files"], "status": first["status"]})

    auto = js("const was = JSON.parse((await readPlan()).text).lrfNextKeep.savedAt; A.setOwn('crates', 'bench', 'Count crates on the benches'); await wait(400); const early = JSON.parse((await readPlan()).text).lrfNextKeep.savedAt; await wait(2400); const plan = JSON.parse((await readPlan()).text); return { was, early, now: plan.lrfNextKeep.savedAt, crates: plan.lrfNextKeep.keep.crates, status: document.getElementById('saveState').textContent };")
    check("a change is written to the folder by itself a moment later, with what was settled here", auto["early"] == auto["was"] and auto["now"] > auto["was"] and auto["crates"] == "bench" and auto["status"].startswith("Saved · Farm plan"), auto)

    manual = js("const was = JSON.parse((await readPlan()).text).lrfNextKeep.savedAt; await wait(30); const done = await A.saveNow(); const now = JSON.parse((await readPlan()).text).lrfNextKeep.savedAt; return { was, now, done, toast: (document.querySelector('.toast') || {}).textContent || '', note: document.getElementById('saveNowNote').textContent };")
    check("Save now writes the file at once and says so", manual["now"] > manual["was"] and manual["done"].get("saved") and "Saved to the folder" in manual["toast"] and "Writes the plan file" in manual["note"], manual)
    page.wait_for_timeout(40)
    keyed = js("const was = JSON.parse((await readPlan()).text).lrfNextKeep.savedAt; document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); await wait(900); return { was, now: JSON.parse((await readPlan()).text).lrfNextKeep.savedAt };")
    check("Ctrl+S saves it too", keyed["now"] > keyed["was"], keyed)

    # the first save of a new day puts the plan as it was left into the history
    hist = js("""const file = await readPlan(), plan = JSON.parse(file.text), y = new Date(Date.now() - 86400000 * 2).toISOString();
      plan.lrfNextKeep.savedAt = y; plan.settings.note = 'as left two days ago'; await put(JSON.stringify(plan));
      localStorage.setItem('lrf-next:folder-wrote', JSON.stringify({ name: 'Farm plan', savedAt: y })); await F.restore(await dirOf());
      const info = F.info(); const done = await A.saveToFolder(); const list = await names('history'), d = await (await dirOf()).getDirectoryHandle('history');
      const old = list.length ? JSON.parse(await (await (await d.getFileHandle(list[0])).getFile()).text()) : null;
      return { info, done, list, day: y.slice(0, 10), note: old && old.settings.note, now: JSON.parse((await readPlan()).text).settings.note || null };""")
    check("the plan as it was left on an earlier day is kept in the history before the day's first save", hist["done"].get("saved") and not hist["info"]["conflict"] and hist["list"] == [f"plan-{hist['day']}.json"] and hist["note"] == "as left two days ago" and hist["now"] is None, hist)

    # a plan this browser did not write is never written over
    clash = js("""const mine = S.plan.plantings.length, plan = JSON.parse((await readPlan()).text); plan.plantings = plan.plantings.slice(0, plan.plantings.length - 5);
      plan.lrfNextKeep = { v: 1, savedAt: new Date(Date.now() + 60000).toISOString(), device: 'another-computer', keep: { crates: 'bench', trayStart: 'monday' } }; await put(JSON.stringify(plan));
      A.setOwn('crates', null, 'Crates on the floor'); await wait(2600);
      const there = JSON.parse((await readPlan()).text);
      return { mine, there: there.plantings.length, device: there.lrfNextKeep.device, info: F.info(), status: document.getElementById('saveState').textContent, menu: document.getElementById('folderMenu').textContent };""")
    check("when the file was changed somewhere else, saving stops: the other plan is left alone and the app asks", clash["there"] == clash["mine"] - 5 and clash["device"] == "another-computer" and clash["info"]["conflict"] and "Folder holds another plan" in clash["status"] and "Open the folder’s plan" in clash["menu"] and "somewhere else" in clash["menu"], clash)
    page.click("#dataBtn"); page.wait_for_timeout(200); page.screenshot(path=str(shots / "folder-conflict.png")); page.keyboard.press("Escape"); page.mouse.click(300, 400)

    # it survives a reload, still asking; opening the folder's plan takes it, with what was settled there
    page.reload(); ready()
    # (this test browser cannot read a folder back out of its own database, so the folder is handed in again where the app would recall it)
    again = js("await F.restore(await dirOf()); await wait(200); return { info: F.info(), plantings: S.plan.plantings.length, status: document.getElementById('saveState').textContent };")
    check("after a reload the folder is still known, and still not written over", again["info"]["connected"] and again["info"]["conflict"] and again["plantings"] == clash["mine"] and "Folder holds another plan" in again["status"], again)
    page.evaluate("void LRFApp.openFolderPlan()"); page.wait_for_selector("dialog.dialog"); page.locator("dialog.dialog .btn.danger").click(); page.wait_for_timeout(2500)
    opened = js("await wait(2200); const there = JSON.parse((await readPlan()).text); return { plantings: S.plan.plantings.length, keep: [S.plan.lrfNext.crates || null, S.plan.lrfNext.trayStart || null], info: F.info(), fileDevice: there.lrfNextKeep.device, filePlantings: there.plantings.length, mine: F.device(), status: document.getElementById('saveState').textContent };")
    check("opening the folder's plan replaces the one here, keeps what was settled in it, and saving goes on from it", opened["plantings"] == clash["mine"] - 5 and opened["keep"] == ["bench", "monday"] and not opened["info"]["conflict"] and opened["filePlantings"] == clash["mine"] - 5 and opened["fileDevice"] == "another-computer" and opened["status"].startswith("Saved · Farm plan"), opened)
    onward = js("A.setOwn('trays', 'variety', 'Every variety in trays of its own'); await wait(2500); const there = JSON.parse((await readPlan()).text); return { device: there.lrfNextKeep.device === F.device(), trays: there.lrfNextKeep.keep.trays, plantings: there.plantings.length, conflict: F.info().conflict };")
    check("the next change after that is saved to the folder as usual", onward["device"] and onward["trays"] == "variety" and onward["plantings"] == clash["mine"] - 5 and not onward["conflict"], onward)

    # keeping the plan here instead writes it over the folder's, on request only
    over = js("""const plan = JSON.parse((await readPlan()).text); plan.lrfNextKeep = { v: 1, savedAt: new Date(Date.now() + 120000).toISOString(), device: 'another-computer', keep: {} }; plan.plantings = plan.plantings.slice(0, 10); await put(JSON.stringify(plan));
      A.setOwn('crates', null, 'Crates on the floor'); await wait(2400); const held = JSON.parse((await readPlan()).text).plantings.length; const done = await A.overwriteFolder(); const now = JSON.parse((await readPlan()).text);
      return { held, done, now: now.plantings.length, mine: S.plan.plantings.length, device: now.lrfNextKeep.device === F.device(), info: F.info() };""")
    check("'Keep this plan' writes it over the folder's, and only then", over["held"] == 10 and over["done"].get("saved") and over["now"] == over["mine"] and over["device"] and not over["info"]["conflict"], over)

    left = js("const was = JSON.parse((await readPlan()).text).lrfNextKeep.savedAt; await A.leaveFolder(); A.setOwn('crates', 'bench', 'x'); await wait(2400); return { info: F.info(), same: JSON.parse((await readPlan()).text).lrfNextKeep.savedAt === was, status: document.getElementById('saveState').textContent, files: await names() };")
    check("leaving the folder stops the writing and leaves its files", not left["info"]["connected"] and left["same"] and "little-river-plan.json" in left["files"] and "Saved on this device" in left["status"], left)
    check("no errors on the page", not errors, errors[:4])
    browser.close()
server.shutdown()
print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "results": [r for r in results if not r["ok"]]}, indent=1))
sys.exit(1 if failed else 0)
