"""Loading a newer backup over a plan that has things established here: what is kept, and that the page says so.
usage: python3 -I carry_check.py <site-dir> <backup.zip> <shots-dir>
"""
import functools, http.server, json, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

site, backup, shots = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
shots.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(site)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = {}, [], []


def check(name, ok, detail=None):
    results[name] = {"ok": bool(ok), **({"detail": detail} if detail is not None else {})}
    if not ok:
        failed.append(name)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = browser.new_context(viewport={"width": 1480, "height": 900}).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    js = lambda expr: page.evaluate(f"(() => {{ const A = LRFApp, S = A.state, E = LRFEngine, T = LRFTrays, eng = S.engine; return {expr}; }})()")

    def load(confirm):
        page.set_input_files("#importFile", backup)
        said = None
        if confirm:
            page.wait_for_selector("dialog.dialog", timeout=60000)
            said = page.locator("dialog.dialog p").inner_text()
            page.locator("dialog.dialog .btn.danger").click()
        page.wait_for_function("!LRFApp.isSample() && /Saved/.test(document.getElementById('saveState').textContent)", timeout=120000)
        page.wait_for_timeout(1500)
        return said

    page.goto(url)
    page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    page.wait_for_timeout(600)
    load(False)
    first = js("({plantings: S.plan.plantings.length, from: ((S.plan.liveTrayPlans || [])[0] || {}).from, own: Object.keys(S.plan.lrfNext).sort(), backup: S.plan.lrfNext.backup, toast: document.querySelector('#toast span').textContent})")
    # What the lines below are about is found in the backup, and said by name when it is not there: a backup says when it was made, and
    # the Monday rule needs a tray demand whose first day is not a Monday (and has a Monday before its last day) to have anything to move.
    opens = js("(f => ({ from: f || null, monday: f ? T.mondayOnOrAfter(f) : null, through: ((S.plan.liveTrayPlans || [])[0] || {}).through || null }))(((S.plan.liveTrayPlans || [])[0] || {}).from)")
    check("the backup says when it was made", bool(first["backup"]), first["backup"])
    check("the backup has a tray demand that opens mid-week, for the Monday rule to move", bool(opens["from"]) and opens["monday"] != opens["from"] and opens["monday"] <= (opens["through"] or ""), opens)
    check("a first load brings the backup as it is: nothing to carry, mid-week opening and all", first["plantings"] > 600 and "facts" not in first["own"] and "trayStart" not in first["own"] and first["backup"] and "Kept" not in first["toast"], first)

    # establish things here: an assumption, a seed rate, a garden's conditions, a bed's length, crates on benches, trays on Mondays
    made = page.evaluate("""(async () => { const A = LRFApp, S = A.state, eng = S.engine;
      await A.setAssumption('crops', 'carrot', 'field', 71, 'Carrot in the field: 71 days');
      const crop = S.plan.crops.find(c => c.micro); A.commit('seed', [{ kind: 'crop', before: crop, after: { ...crop, seedG: 14 } }], { unchecked: true });
      const garden = S.plan.gardens.find(g => g.type === 'greenhouse' && !g.liveTrayPool && g.name.includes('Shade')) || S.plan.gardens.find(g => g.type === 'greenhouse' && !g.liveTrayPool);
      await A.setGardenType(garden.id, 'tunnel');
      const dialog = document.querySelector('dialog.dialog'); if (dialog) dialog.querySelector('.btn.primary').click();
      await new Promise(r => setTimeout(r, 300));
      const bed = S.plan.beds.find(b => A.state.engine.isSoilBed(b) && A.state.engine.plantingsIn(b.id).length === 0); A.updateBeds([bed.id], { l: bed.l + 3 }, 'longer bed');
      A.setOwn('crates', 'bench', 'crates on benches');
      const moved = await A.traysToMonday();
      return { crop: crop.id, garden: garden.id, gardenType: A.state.plan.gardens.find(g => g.id === garden.id).type, bed: bed.id, bedL: bed.l + 3, moved, facts: A.state.plan.lrfNext.facts, from: A.state.plan.liveTrayPlans[0].from, plantings: A.state.plan.plantings.length }; })()""")
    check("changes made here are noted beside the plan", made["gardenType"] == "tunnel" and set(made["facts"].keys()) == {"crops", "gardens", "beds"} and made["facts"]["crops"][made["crop"]]["set"] == {"seedG": 14} and made["facts"]["beds"][made["bed"]]["set"]["l"] == made["bedL"] and made["from"] != first["from"] and len(made["moved"]) == 1, {k: made[k] for k in ("gardenType", "from", "moved", "plantings")})
    page.wait_for_timeout(1500)

    # the same backup again stands in for a newer one that still holds the old values
    said = load(True)
    after = js(f"""({{plantings: S.plan.plantings.length, list: ((S.plan.assumptions || {{}}).crops || {{}}).carrot, seedG: S.plan.crops.find(c => c.id === '{made['crop']}').seedG, garden: S.plan.gardens.find(g => g.id === '{made['garden']}').type,
      bedL: S.plan.beds.find(b => b.id === '{made['bed']}').l, crates: S.plan.lrfNext.crates, rule: S.plan.lrfNext.trayStart, from: S.plan.liveTrayPlans[0].from, facts: Object.keys(S.plan.lrfNext.facts || {{}}).sort(), bench: eng.cratesOnBenches,
      dtm: eng.timingFor('carrot', null, 'field').mine, toast: document.querySelector('#toast span').textContent, undo: S.undo.length}})""")
    check("the confirmation says what the backup replaces and what is kept", "Plantings, tray demand and seed stock are replaced" in said and "Kept from this copy" in said and "assumptions list (1 figure)" in said and "3 records" in said and "opening on a Monday" in said, said)
    check("after the load, everything established here is still so", after["list"] == {"field": {"dtm": 71}} and after["dtm"] == 71 and after["seedG"] == 14 and after["garden"] == "tunnel" and after["bedL"] == made["bedL"] and after["crates"] == "bench" and after["bench"] and after["rule"] == "monday" and after["from"] == made["from"] and after["facts"] == ["beds", "crops", "gardens"] and after["plantings"] == made["plantings"] and "Kept from this copy" in after["toast"], after)
    page.screenshot(path=str(shots / "carry-after.png"))
    # and a reload keeps it
    page.reload()
    page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    page.wait_for_timeout(800)
    again = js(f"({{seedG: S.plan.crops.find(c => c.id === '{made['crop']}').seedG, crates: S.plan.lrfNext.crates, list: !!(S.plan.assumptions && S.plan.assumptions.crops.carrot)}})")
    check("and it is all there after a reload", again["seedG"] == 14 and again["crates"] == "bench" and again["list"], again)
    # a backup downloaded from here carries none of this app's own record, and the plan's own fields as changed
    exported = page.evaluate("""(async () => { const A = LRFApp, IO = LRFPlanIO; const plan = IO.join(A.state.plan, { v: 1, rest: {}, varieties: {} }); return { own: 'lrfNext' in plan, list: !!plan.assumptions, from: plan.liveTrayPlans[0].from }; })()""")
    check("a backup made here does not carry this app's own record", not exported["own"] and exported["list"] and exported["from"] == made["from"], exported)
    browser.close()
server.shutdown()
check("no errors on the page", not errors, errors[:6])
print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "results": {k: v for k, v in results.items() if not v["ok"]}}, indent=1))
sys.exit(1 if failed else 0)
