"""A run of successions added and taken out by the page's own steps (E4, stage 1), in a real browser.
LRFApp.addRun adds a run's record and every planting the solver found a bed for as one step, which one Undo takes back; it is
refused whole, with nothing added, when the guard rails turn down any one of its plantings. LRFApp.removeRun takes a run's record
out as one step: its plantings stay as plain plantings, or go with it when asked. The plan the browser stores holds the run.
Nothing on the page is touched: no screen of this stage shows a run. Every subject is found on the plan the page was given.
usage: python3 -I run_check.py <app-dir> <shots-dir>
"""
import functools, http.server, json, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
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
    sys.stdout.flush(); import os; os._exit(1 if failed else 0)

FAKE = "(() => { const R = Date, off = new R(2027, 2, 16, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();"
WORK = r"""
(async () => {
  const A = LRFApp, S = A.state, SU = LRFSuccession, E = LRFEngine, eng = () => S.engine, year = A.planYear(), out = {};
  const stored = () => { try { return JSON.parse(localStorage.getItem('lrf-next:plan')); } catch (_) { return null; } };
  const settle = () => new Promise(r => setTimeout(r, 900));
  // a crop and its field gardens where a run of four sowings two weeks apart finds a whole bed for each
  const field = c => SU.gardensFor(eng(), c).filter(g => g.kind === 'bed' && g.garden.type === 'field').map(g => g.garden.id);
  let result = null;
  for (const c of SU.candidates(eng(), true)) { const g = field(c); if (!g.length) continue; const r = SU.planRun(eng(), { cropId: c.id, by: 'beds', every: 14, datesFor: 'planting', from: year + '-06-01', to: year + '-07-13', gardenIds: g }); if (!r.error && r.sowings.length >= 3) { result = r; break; } }
  out.found = !!result;
  if (!result) return out;
  const id = result.run.id, n = result.sowings.length, ofRun = () => S.plan.plantings.filter(p => p.run && p.run.id === id);
  const key0 = A.contentKey(), count0 = S.plan.plantings.length, undo0 = S.undo.length;
  out.steps = { addRun: typeof A.addRun, removeRun: typeof A.removeRun, runs: typeof A.runs };
  out.added = A.addRun(result);
  out.afterAdd = { steps: S.undo.length - undo0, plantings: S.plan.plantings.length - count0, ofRun: ofRun().length, n, runs: A.runs().map(r => r.id), marks: ofRun().map(p => p.run.n).join(), label: S.undo[S.undo.length - 1] && S.undo[S.undo.length - 1].label };
  await settle();
  const st = stored();
  out.stored = st ? { runs: ((st.lrfNext || {}).runs || []).map(r => r.id), ofRun: st.plantings.filter(p => p.run && p.run.id === id).length } : null;
  out.again = A.addRun(result);
  out.againSteps = S.undo.length - undo0;
  A.undo();
  out.afterUndo = { key: A.contentKey() === key0, plantings: S.plan.plantings.length - count0, ofRun: ofRun().length, runs: A.runs().length, own: 'runs' in (S.plan.lrfNext || {}) };
  A.redo();
  out.afterRedo = { ofRun: ofRun().length, runs: A.runs().length };
  A.undo();
  // refused whole: a planting put first into the ground one sowing of the run would take, then the run asked for
  const second = result.sowings[1].p, blocker = { ...second, id: 'run-check-blocker' }; delete blocker.run;
  out.blocked = A.addPlantings([blocker], 'A planting in the way');
  const key1 = A.contentKey(), undo1 = S.undo.length;
  out.refused = A.addRun(result);
  out.afterRefused = { same: A.contentKey() === key1, steps: S.undo.length - undo1, ofRun: ofRun().length, runs: A.runs().length };
  A.undo();
  out.error = A.addRun({ error: 'Choose a crop.' });
  // taken out, its plantings kept as plain plantings; then with them
  out.readd = A.addRun(result);
  const kept0 = ofRun().map(p => p.id).sort().join();
  out.removed = A.removeRun(id);
  const plainNow = S.plan.plantings.filter(p => kept0.split(',').includes(p.id));
  out.afterRemove = { runs: A.runs().length, plantings: plainNow.length, marks: plainNow.filter(p => p.run).length, others: plainNow.every(p => { const q = result.sowings.find(x => x.p.id === p.id).p, a = { ...q }; delete a.run; return JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]])) === JSON.stringify(Object.keys(p).sort().map(k => [k, p[k]])); }) };
  A.undo();
  out.afterRemoveUndo = { runs: A.runs().length, ofRun: ofRun().map(p => p.id).sort().join() === kept0 };
  out.removedAll = A.removeRun(id, { plantings: true });
  out.afterRemoveAll = { runs: A.runs().length, left: S.plan.plantings.filter(p => kept0.split(',').includes(p.id)).length };
  A.undo();
  out.afterRemoveAllUndo = { runs: A.runs().length, ofRun: ofRun().length };
  A.undo();
  out.end = A.contentKey() === key0;
  return out;
})()
"""
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = browser.new_context(viewport={"width": 1480, "height": 900}).new_page()
    page.add_init_script(FAKE)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000); page.wait_for_timeout(1200)
    page.evaluate("LRFUI.toast = () => {}")
    o = page.evaluate(WORK)
    check("the farm has a crop a run of whole beds two weeks apart places three times or more", o.get("found"), o)
    if o.get("found"):
        a = o["afterAdd"]
        check("the page has the steps: LRFApp.addRun, LRFApp.removeRun and LRFApp.runs", o["steps"] == {"addRun": "function", "removeRun": "function", "runs": "function"}, o["steps"])
        check("adding a run is one step: its record and every sowing that found a bed, each planting marked with its number", o["added"] is True and a["steps"] == 1 and a["plantings"] == a["n"] and a["ofRun"] == a["n"] and len(a["runs"]) == 1 and a["marks"] == ",".join(str(i + 1) for i in range(a["n"])), a)
        check("the plan the browser stores holds the run and its plantings", o["stored"] is not None and len(o["stored"]["runs"]) == 1 and o["stored"]["ofRun"] == a["n"], o["stored"])
        check("the same run is not added twice", o["again"] is False and o["againSteps"] == 1, [o["again"], o["againSteps"]])
        check("one Undo takes all of it back: the plan is as it was, with no list of runs left behind", o["afterUndo"] == {"key": True, "plantings": 0, "ofRun": 0, "runs": 0, "own": False}, o["afterUndo"])
        check("and Redo puts all of it back", o["afterRedo"] == {"ofRun": a["n"], "runs": 1}, o["afterRedo"])
        check("a run one of whose plantings the guard rails turn down is refused whole: nothing of it is added", o["blocked"] is True and o["refused"] is False and o["afterRefused"] == {"same": True, "steps": 0, "ofRun": 0, "runs": 0}, [o["blocked"], o["refused"], o["afterRefused"]])
        check("a result that is an error adds nothing", o["error"] is False)
        r = o["afterRemove"]
        check("a run taken out keeps its plantings as plain plantings: the mark of the run off, nothing else of them changed", o["readd"] is True and o["removed"] is True and r["runs"] == 0 and r["plantings"] == a["n"] and r["marks"] == 0 and r["others"], r)
        check("and one Undo puts the run and its marks back", o["afterRemoveUndo"] == {"runs": 1, "ofRun": True}, o["afterRemoveUndo"])
        check("a run taken out with its plantings takes them too, and one Undo puts all back", o["removedAll"] is True and o["afterRemoveAll"] == {"runs": 0, "left": 0} and o["afterRemoveAllUndo"] == {"runs": 1, "ofRun": a["n"]}, [o["afterRemoveAll"], o["afterRemoveAllUndo"]])
        check("undone to the start, the plan is the one the page opened with", o["end"] is True)
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
