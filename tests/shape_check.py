"""The plan's shape (tests/plan_shape.cjs) held to what the page itself writes, in a real browser.
The page changes a plan in one place, app.js withOps, and each change is a step of kinds: a planting, a bed, a garden, a
crop, a variety, the list of assumptions, the settings, the map, the seed on hand, the live-tray plans, the nursery and the
planner's own record kept beside the plan. This check takes a tour of the page's own functions that make those steps (each
called as a screen calls it), on the made-up farm, on a pretended day in the season, and then holds to the written shape
every record each step wrote, the plan as the page holds it, the plan as the browser stores it and the plan as a file holds
it. So a build that writes a field the shape does not name, or a new kind of step, fails here and says where.
Every subject is found on the plan the page was given; nothing here names a crop, a bed or a number of any plan.
usage: python3 -I shape_check.py <app-dir> <shots-dir> <repository>
"""
import functools, http.server, json, os, re, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots, repo = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]); shots.mkdir(parents=True, exist_ok=True)
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

# the kinds of step withOps applies, read from its code: each `op.kind === '…'`, the kinds kept in a list, and a planting (no kind)
app_js = (target / "js" / "app.js").read_text(encoding="utf-8")
body = app_js[app_js.find("function withOps("):app_js.find("function adopt(")]
listed = re.search(r"\{ ([^{}]*) \}\[op\.kind\]", body)
KINDS = sorted(set(re.findall(r"op\.kind === '(\w+)'", body)) | set(re.findall(r"(\w+): '\w+'", listed.group(1)) if listed else []) | {"planting"})
PLACE = {"planting": "plantings[]", "bed": "beds[]", "garden": "gardens[]", "crop": "crops[]", "variety": "varieties[]", "assume": "assumptions", "settings": "settings",
         "map": "map", "inventory": "seedInventory", "trays": "liveTrayPlans", "nursery": "nursery"}   # and own: lrfNext.<its key>
check("the kinds of step the page applies can be read from withOps, and the shape knows where each is written", len(KINDS) >= 10 and all(k in PLACE or k == "own" for k in KINDS), KINDS)

FAKE = "(() => { const R = Date, off = new R(2027, 5, 16, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();"
# Each step: a name, and a function of the page that changes the plan, called as a screen calls it. A step that finds no subject
# on the plan returns 'no subject', and its line fails: the tour does not pass over a step in silence.
TOUR = r"""
(async () => {
  const A = LRFApp, S = A.state, E = LRFEngine, eng = () => S.engine, out = {}, year = A.planYear();
  LRFUI.confirm = async () => true;   // every window that asks first is answered yes, as a grower who goes ahead
  const yes = setInterval(() => { const b = document.querySelector('dialog[open] .dialog-actions .btn.primary'); if (b) b.click(); }, 100);   // and the page's own windows
  const step = async (name, run) => { const n = S.undo.length; let r; try { r = await Promise.race([run(), new Promise((_, no) => setTimeout(() => no(new Error('no answer in 10 seconds')), 10000))]); } catch (e) { out[name] = { took: false, why: String(e && e.message || e).slice(0, 200) }; return; } out[name] = { took: S.undo.length > n, why: r === 'no subject' ? r : undefined }; };
  const P = () => S.plan.plantings, plain = P().filter(p => !p.liveTray && !p.bedLayout && !p.towerCycle && !p.done);
  const sold = plain.map(p => eng().crop(p.cropId)).find(c => c && eng().harvestFor(c.id) && !eng().harvestFor(c.id).micro && !eng().isCoverCrop(c) && eng().harvestFor(c.id).house.farm);
  const vOf = c => S.plan.varieties.find(v => v.cropId === c.id && v.active !== false) || S.plan.varieties[0];
  await step('a planting edited', () => A.updatePlanting(plain[1].id, { note: 'a note' }, 'A note'));
  await step('a planting given its own sowing day', () => { const p = plain.find(q => LRFSeedLib.sowing(eng(), q)); return p ? A.updatePlanting(p.id, { sowOn: year + '-03-03' }, 'Sow on') : 'no subject'; });
  await step('a planting, a bed and a garden marked for personal use', async () => { await A.setUse('planting', [plain[3].id], 'personal'); await A.setUse('bed', [plain[4].bedId], 'personal'); return A.setUse('garden', [S.plan.gardens[1].id], 'personal'); });
  await step('a bed edited', () => A.updateBeds([S.plan.beds[2].id], { note: 'a note' }, 'A note'));
  await step('the farm\'s dates changed', () => { const d = A.farmDates().dates; return A.setFarmDates({ ...d, frostLast: d.frostLast === '05-12' ? '05-13' : '05-12' }); });
  await step('a garden\'s kind changed', () => { const g = S.plan.gardens[2]; return A.setGardenType(g.id, g.type === 'field' ? 'tunnel' : 'field'); });
  await step('days to harvest set for a crop and a variety', async () => { if (!sold) return 'no subject'; await A.setAssumption('crops', sold.id, 'field', 55, 'Days'); return A.setAssumption('varieties', vOf(sold).id, 'field', 57, 'Days'); });
  await step('a yield set', () => sold ? A.setYield('crops', sold.id, 'field', 3.5, 'Yield') : 'no subject');
  await step('a crop\'s price and personal use set', () => sold ? A.setSell(sold.id, { price: 4.25, keep: 5 }, 'Price') : 'no subject');
  await step('a variety\'s price set', () => sold ? A.setSellV(vOf(sold).id, { price: 5.5 }, 'Price') : 'no subject');
  await step('a crop looked at', () => sold ? A.setLooked(sold.id, true) : 'no subject');
  await step('a crop grown for sale and personal use', () => sold ? A.setHouse(sold.id, true) : 'no subject');
  await step('something else sold from a crop, added and priced', async () => { if (!sold) return 'no subject'; const id = A.addThing(sold.id, { from: 'harvest', name: 'Second thing', unit: 'bunch' }); return id ? A.setThing(sold.id, id, { price: 3, share: 10 }, 'Price') : 'no subject'; });
  await step('where a crop\'s days start', () => sold ? A.setStarts([{ cropId: sold.id, from: 'seed', less: 10 }], 'Days start') : 'no subject');
  await step('a planting grown for one of the things its crop sells', async () => {
    const p = plain.find(q => { const c = eng().crop(q.cropId), h = c && eng().harvestFor(c.id); return c && c !== sold && h && !h.micro && !eng().isCoverCrop(c); });
    if (!p) return 'no subject';
    const id = A.addThing(p.cropId, { from: 'bed', name: 'Out of the bed', unit: 'bunch' });
    if (!id) return 'no subject';
    await A.setThing(p.cropId, id, { price: 2, share: 20, yield: 1 }, 'Second thing');
    return A.setGives(p.id, id);
  });
  await step('the planner\'s own record changed', () => A.setOwn('trays', (S.plan.lrfNext || {}).trays ? null : 'variety', 'Trays'));
  await step('supplies on hand', () => A.setSupply('mix', '72', 0.5));
  await step('the benches changed', () => A.editNursery('Packing', n => ({ ...n, packing: (n && n.packing) === 'tight' ? 'loose' : 'tight' })));
  await step('how a live-tray crop is sown', () => { const m = (S.plan.crops || []).find(c => c.micro); return m ? A.setLiveSow(m.id, { how: 'cells', cells: 98, perCell: 3 }) : 'no subject'; });
  await step('a seed lot added and one counted', async () => { const lots = (A.inventoryNow().lots || []).filter(l => l.deleted !== true); if (!lots.length) return 'no subject'; A.editStock('Add', (inv, ctx) => LRFSeedLib.addLot(inv, { key: lots[0].key, unit: 'seeds', quantity: 50, status: 'ordered' }, ctx)); return A.editStock('Count', (inv, ctx) => LRFSeedLib.updateLot(inv, lots[0].id, { quantity: 3 }, 'count', ctx)); });
  await step('a crop sown from seed', () => { const own = (S.plan.crops || []).find(c => !c.micro); return own ? A.revise('From seed', [{ kind: 'crop', before: own, after: { ...own, plantingMaterial: 'seed' } }]) : 'no subject'; });
  await step('where a variety\'s days are counted from', () => { const v = S.plan.varieties.find(x => x.active !== false); return v ? A.revise('Counted from', [{ kind: 'variety', before: v, after: { ...v, catalogMaturityBasis: 'transplant', catalogSourceChoice: v.catalogSourceChoice || 'url' } }]) : 'no subject'; });
  await step('the photo\'s scale', () => { const m = S.plan.map || {}; return m.ftPerPx ? A.commit('Scale', [{ kind: 'map', before: m, after: { ...m, ftPerPx: m.ftPerPx * 1.01 } }]) : 'no subject'; });
  await step('a live-tray plan deleted', () => { const t = (S.plan.liveTrayPlans || [])[0]; return t ? A.removeTrays(t.id) : 'no subject'; });
  // the week's work, on plantings found on the farm with that job open
  const jobs = [];
  for (const p of plain.slice(5)) { let st = []; try { st = LRFWeek.steps(eng(), p); } catch (_) { continue; } for (const s of st) if (!s.done) jobs.push({ id: p.id, kind: s.kind, day: E.d2s(s.planned) }); }
  const first = (kind, not = []) => jobs.find(j => j.kind === kind && !not.includes(j.id));
  // one planting that is sown, potted up, hardened off and planted out, recorded in that order; and one moved out
  const chain = [...new Set(jobs.map(j => j.id))].find(id => ['sow', 'potup', 'harden', 'field'].every(k => jobs.some(j => j.id === id && j.kind === k)));
  const used = chain ? [chain] : [];
  for (const kind of ['sow', 'potup', 'harden', 'field']) await step('recorded: ' + kind, () => { const j = chain && jobs.find(x => x.id === chain && x.kind === kind); return j ? A.recordWork([{ id: j.id, kind }], { date: j.day }) : 'no subject'; });
  await step('recorded: move', async () => { const id = [...new Set(jobs.map(j => j.id))].find(x => !used.includes(x) && jobs.some(j => j.id === x && j.kind === 'move') && jobs.some(j => j.id === x && j.kind === 'field')); if (!id) return 'no subject'; used.push(id); for (const kind of ['sow', 'potup', 'harden', 'field']) { const j = jobs.find(x => x.id === id && x.kind === kind); if (j) await A.recordWork([{ id, kind }], { date: j.day }); } const m = jobs.find(x => x.id === id && x.kind === 'move'); return A.recordWork([{ id, kind: 'move' }], { date: m.day }); });
  await step('a job taken back', () => { const p = P().find(q => q.done && q.done.harden); return p ? A.takeBackWork([{ id: p.id, kind: 'harden' }]) : 'no subject'; });
  await step('a job put off, and one that moves its planting', async () => { const a = first('potup', used), b = first('field', used); if (!a || !b) return 'no subject'; await A.delayWork([{ id: a.id, kind: 'potup' }], E.d2s(E.addDays(E.s2d(a.day), 2))); return A.delayWork([{ id: b.id, kind: 'field' }], E.d2s(E.addDays(E.s2d(b.day), 2))); });
  await step('a job skipped and one given a note', () => { const j = jobs.filter(x => !used.includes(x.id)); if (j.length < 12) return 'no subject'; A.skipWork([{ id: j[10].id, kind: j[10].kind }], year + '-04-01'); return A.noteWork([{ id: j[11].id, kind: j[11].kind }], 'a note'); });
  // plantings made, sent to wait, placed and taken away
  await step('a planting sent to wait, and changed while it waits', () => { if (!A.sendToWait(plain[30].id)) return 'no subject'; const w = (A.waiting() || [])[0]; return w ? A.updateWaiting(w.id, { note: 'a note' }, 'A note') : 'no subject'; });
  await step('a succession added', () => A.addSuccessions(plain[40].id, 1, 14));
  await step('a variety added to a bed', () => { const p = plain.find(q => S.plan.varieties.some(v => v.cropId === q.cropId && v.id !== q.varietyId)); return p ? A.addVarieties(p.id, [S.plan.varieties.find(v => v.cropId === p.cropId && v.id !== p.varietyId).id]) : 'no subject'; });
  await step('a planting taken away', () => A.removePlantings([plain[60].id]));
  clearInterval(yes);
  const kinds = [...new Set(S.undo.flatMap(s => s.ops.map(o => o.kind || 'planting')))];
  return { out, kinds };
})()
"""
PLACES = "({ planting: 'plantings[]', bed: 'beds[]', garden: 'gardens[]', crop: 'crops[]', variety: 'varieties[]', assume: 'assumptions', settings: 'settings', map: 'map', inventory: 'seedInventory', trays: 'liveTrayPlans', nursery: 'nursery' })"
HOLD = """
(() => {
  const S = LRFApp.state, SH = LRFShape, at = %s, bad = [], seen = new Set();
  for (const step of S.undo) for (const op of step.ops) {
    const kind = op.kind || 'planting', place = kind === 'own' ? 'lrfNext.' + op.key : at[kind];
    for (const rec of [op.before, op.after]) {
      if (rec == null) continue;
      const r = SH.check(rec, place);
      for (const x of r.unknown.concat(r.wrong)) { const k = x.place + (x.got ? ':' + x.got : ''); if (!seen.has(k)) { seen.add(k); bad.push({ step: step.label, kind, ...x }); } }
    }
  }
  const short = r => ({ unknown: r.unknown.slice(0, 8), wrong: r.wrong.slice(0, 8) });
  const stored = (() => { try { return JSON.parse(localStorage.getItem('lrf-next:plan')); } catch (_) { return null; } })();
  const own = Object.fromEntries(['crates', 'trayStart', 'trays', 'groups', 'facts', 'waiting', 'supplies'].filter(k => (S.plan.lrfNext || {})[k] != null).map(k => [k, S.plan.lrfNext[k]]));
  const file = { ...LRFPlanIO.join(S.plan, { v: 1, rest: {}, varieties: {} }), lrfNextKeep: { v: 1, savedAt: new Date().toISOString(), device: 'device-1', keep: own } };
  return { steps: S.undo.length, bad: bad.slice(0, 12), held: short(SH.check(S.plan)), stored: stored ? short(SH.check(stored)) : null, file: short(SH.check(file, '', { attic: LRFPlanIO.CORE_KEYS })) };
})()
""" % PLACES
clean = lambda r: r is not None and not r["unknown"] and not r["wrong"]

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = browser.new_context(viewport={"width": 1480, "height": 900}).new_page()
    page.add_init_script(FAKE)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000); page.wait_for_timeout(1200)
    page.add_script_tag(content=(repo / "tests" / "plan_shape.cjs").read_text(encoding="utf-8"))
    first = page.evaluate("({ plantings: LRFApp.state.plan.plantings.length, shape: !!(window.LRFShape && LRFShape.check), clean: (() => { const r = LRFShape.check(LRFApp.state.plan); return !r.unknown.length && !r.wrong.length; })() })")
    check("the page opened on the farm, and the plan it opened fits the written shape", first["plantings"] > 100 and first["shape"] and first["clean"], first)
    tour = page.evaluate(TOUR)
    page.wait_for_timeout(1500)   # the last change is stored a moment after it is made
    for name, r in tour["out"].items():
        check(f"the tour: {name}", r.get("took"), r)
    check("every kind of step withOps applies was made by the tour", set(KINDS) <= set(tour["kinds"]), {"not made": sorted(set(KINDS) - set(tour["kinds"])), "made": tour["kinds"]})
    held = page.evaluate(HOLD)
    check("every record each step of the tour wrote, before and after, fits the written shape", held["steps"] >= len(tour["out"]) and not held["bad"], held["bad"])
    check("the plan as the page holds it fits the written shape", clean(held["held"]), held["held"])
    check("the plan as the browser stores it fits the written shape", clean(held["stored"]), held["stored"])
    check("the plan as a file holds it fits the written shape", clean(held["file"]), held["file"])
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
