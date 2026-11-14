"""Deliberate faults for step F: each is put into a copy of the app, and a named check must fail.
usage: python3 -I mutateF.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: every fault against stepF_test.cjs (give OLD=<dir of the previous js> so a fault that moves a figure by itself is caught). page: faults against stepF_check.py (about a minute each). list: how many faults there are of each kind, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
def alone(cmd, timeout, env=None, cwd=None):
    """Runs one check in a process group of its own. When it is done or out of time, that group is stopped, and so is whatever it
    started and left behind (known by a mark put in its environment): its own browsers and services, and nobody else's."""
    mark = "LRF_FAULT_RUN=%d.%d" % (os.getpid(), time.time_ns())
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd, env={**(env or os.environ), **dict([mark.split("=")])}, start_new_session=True)
    try: out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGTERM)   # the browser's driver closes its browsers when it is asked to stop
        try: out, err = p.communicate(timeout=10)
        except subprocess.TimeoutExpired: os.killpg(p.pid, signal.SIGKILL); out, err = p.communicate()
        out += "\ntimed out"
    try: os.killpg(p.pid, signal.SIGKILL)
    except OSError: pass
    for pid in [x for x in (os.listdir("/proc") if os.path.isdir("/proc") else []) if x.isdigit()]:
        try:
            if mark.encode() in open("/proc/%s/environ" % pid, "rb").read().split(b"\0"): os.kill(int(pid), signal.SIGKILL)
        except OSError: pass
    return out, err
SU, SE, HV = "js/succession.js", "js/series.js", "js/harvestview.js"
NODE = [
 ("a crop nobody has checked is sized anyway", SU, "      if (rests.open) return { error: openWhy(o.crop), unchecked: true };\n", ""),
 ("a yield nobody has checked is never noticed", SU, "open: !y.own && y.by === 'default' && !!(hf && hf.open && hf.open.yield),", "open: false,"),
 ("sized by harvest, the dates are days of going in", SU, "const basis = sized || o.basis === 'harvest' ? 'harvest' : 'planting';", "const basis = o.basis === 'harvest' ? 'harvest' : 'planting';"),
 ("an amount of nothing is taken", SU, "if (sized && !(want > 0 && want <= 1e6)) return", "if (false) return"),
 ("what the plan gives is not taken off", SU, "have = supply ? Math.max(0, +supply(target, end) || 0) : 0;", "have = 0;"),
 ("the plan is asked though told not to", SU, "supply = sized && o.net && typeof input.supply === 'function' ? input.supply : null;", "supply = sized && typeof input.supply === 'function' ? input.supply : null;"),
 ("a stretch nearly filled still gets a planting", SU, "if (asked - have <= asked * COVERED) {", "if (asked - have <= 0) {"),
 ("a stretch half filled gets none", SU, "if (asked - have <= asked * COVERED) {", "if (asked - have <= asked * 0.7) {"),
 ("the last stretch runs past the last day asked for", SU, "const end = o.until && E.addDays(target, o.every - 1) > o.until ? o.until : E.addDays(target, o.every - 1), days", "const end = E.addDays(target, o.every - 1), days"),
 ("a last stretch cut short gets a planting too small for its days", SU, "stretch = Math.max(days, serve) / days;", "stretch = 1;"),
 ("what is asked of a stretch is a day's amount for each day", SU, "const asked = o.want * days / 7,", "const asked = o.want * days,"),
 ("feet are rounded down", SU, "const feetFor = (units, per) => Math.max(Rails.MIN_FT, Math.ceil(units / per - 1e-9));", "const feetFor = (units, per) => Math.max(Rails.MIN_FT, Math.floor(units / per));"),
 ("a planting is spread over beds though one could give it", SU, "for (const pass of sized ? ['one', 'fill'] : ['fill']) for", "for (const pass of ['fill']) for"),
 ("a scrap of the bed is left over", SU, " && r.physicalLength - feetFor(here, g.per) >= SCRAP - EPS) {", ") {"),
 ("a few free feet are started on", SU, "          if (g.soil && r.physicalLength < PIECE - EPS && here > g.y.units + EPS) { note('Only a few feet are free', bed); continue; }\n", ""),
 ("a harvest the season cuts short is asked to make up the days it has not", SU, "part = g.part > 0 ? g.part : 1;", "part = 1;"),
 ("what waits is one planting however long", SU, "n = Math.min(LIMIT, Math.max(1, Math.ceil(ft / Math.max(Rails.MIN_FT, g.cap) - EPS))); for", "n = 1; for"),
 ("what waits has no length", SU, "wave.held.push(heldFor(o, heldDate, k, { why, ft: Math.ceil(ft / n - EPS) })); }", "wave.held.push(heldFor(o, heldDate, k, { why })); }"),
 ("plantings are a fortnight apart whatever the crop", SU, "return { every: clamp(Math.round(g.meant), 7, 366),", "return { every: 14,"),
 ("a crop picked at once is spaced by harvest days it does not have", SU, "meant = once ? Math.max(1, keepDays) : Math.max(1, r.expectedHarvestDays) + more,", "meant = Math.max(1, r.expectedHarvestDays) + more,"),
 ("only the first bed is ever taken", SU, "remaining -= sized ? (y ? y.units : 0) / part :", "remaining -= sized ? 1e9 :"),
 ("the result says the crop's record whatever the sizes rest on", SU, "pattern: rests.y.pattern, by: rests.y.by, env: rests.env,", "pattern: rests.y.pattern, by: 'default', env: rests.env,"),
 ("a sized series leaves plantings out for being picked already", SU, "skipCovered: !sized && o.skipCovered === true,", "skipCovered: o.skipCovered === true,"),
 ("what a planting gives is said to be what was wanted", SU, "wave.got = sized ? wave.placed.reduce((n, x) => n + x.units, 0) :", "wave.got = sized ? wave.want :"),
 ("what a foot gives is what the whole bed gives", SU, "per: size > 0 ? y.units / size : 0,", "per: y.units,"),
 ("the pace is read on the day it goes in", SU, "res = then.r ? then : first, g = gauge(eng, o, res.p, res.r);\n    if (!g) return { error: 'This crop has nothing to pick.', like };", "res = first, g = gauge(eng, o, res.p, res.r);\n    if (!g) return { error: 'This crop has nothing to pick.', like };"),
 ("the result reports no feet", SU, "feet: all.reduce((n, x) => n + (probeSoil(eng, x.bed) ? x.r.physicalLength : 0), 0),", "feet: 0,"),
 ("the feet that wait are not added up", SU, "heldFeet: waves.flatMap(w => w.held).reduce((n, w) => n + (+w.ft || 0), 0),", "heldFeet: 0,"),
 ("the last day asked for is forgotten", SU, "until: sized && E.validDate(to) ? to : null,", "until: null,"),
 ("a series in feet counts beds: the old way moved by itself", SU, ": o.unit === 'ft' && probe.isSoilBed(bed) ? r.physicalLength : 1;\n        work =", ": 1;\n        work ="),
 ("a yield moved by itself", "js/engine.js", "const figure = liveTray ? 1 : nonNegative(own ? p.yield : mine != null ? mine : c.yield);", "const figure = liveTray ? 1 : nonNegative(own ? p.yield : mine != null ? mine : c.yield) * 1.01;"),
 ("the stretch a planting serves is not noted", SU, "Object.assign(wave, { window: { from: target, to: end, days }, asked, have,", "Object.assign(wave, { window: { from: target, to: target, days }, asked, have,"),
 ("a stretch left out still holds a planting to place", SU, "if (asked - have <= asked * COVERED) { wave.skipped = 'covered'; wave.firstHarvest = target; remaining = 0; }", "if (asked - have <= asked * COVERED) { wave.skipped = 'covered'; wave.firstHarvest = target; }"),
]
PAGE = [
 ("the tool stays asked from the harvest end once it has been", SE, "by: focus.by === 'harvest' || (focus.keepBy && P.by === 'harvest') ? 'harvest' : 'spacing' });", "by: P.by });"),
 ("another crop forgets the way of planning", SE, "seed({ cropId: id, keepBy: true });", "seed({ cropId: id });"),
 ("what the plan gives is not handed to the sizing", SE, "supply: model && !pc.error ? supplyOf(model, P.cropId, pc.unit) : undefined };", "supply: undefined };"),
 ("the amount typed does not reach the series", SE, "P.skipCovered, P.by, P.want, P.hFrom,", "P.skipCovered, P.by, P.hFrom,"),
 ("the weeks are judged on the plan without the plantings", SE, "after = n ? F.build(eng2, { year: App.planYear(), use: 'commercial' }) : model;", "after = model;"),
 ("a week with less is drawn solid", SE, "h('i' + (st === 'full' ? '.on' : st === 'part' ? '.part' : ''),", "h('i' + (st !== 'none' ? '.on' : ''),"),
 ("what the sizes rest on is not said", SE, "      if (z) add(out, restsLine(result, crop, eng));\n", ""),
 ("the unchecked crop gets no button", SE, "result && result.unchecked && root.LRFAssume ? h('div.sr-actions'", "false ? h('div.sr-actions'"),
 ("the button opens the days table", SE, "App.setView('assume'); root.LRFAssume.setMode('harvest');", "App.setView('assume');"),
 ("the Harvest view offers it for trays", HV, "row.group !== 'micro' && !!root.LRFSeries", "!!root.LRFSeries"),
 ("the way in forgets the week clicked", HV, "cropId: row.cropId, from: E.d2s(col.start) });", "cropId: row.cropId });"),
 ("the way in opens the tool the old way", HV, "mode: 'series', by: 'harvest', cropId: row.cropId,", "mode: 'series', cropId: row.cropId,"),
 ("the title still says every so many days", SE, "h('h2', { id: 'srTitle' }, sized() ?", "h('h2', { id: 'srTitle' }, false ?"),
 ("the help never says plantings overlap", SE, "'. Closer than that they overlap, and the first weeks come up short.'", "'.'"),
 ("the help never says days are left with nothing", SE, "'. Further apart leaves days with nothing.'", "'.'"),
 ("Add names the step as any series", SE, "`Add ${z ? `${lower(crop)} to ${num(z.want, 1)} a week`", "`Add ${false ? `${lower(crop)} to ${num(z.want, 1)} a week`"),
 ("the old fields stay in place of the new", SE, "        ...(sized() ? [\n", "        ...(false ? [\n"),
 ("the amount's unit can be typed over", SE, "id: 'srWantUnit', disabled: true,", "id: 'srWantUnit',"),
 ("nothing says days are the same in every month", SE, "if (z) add(out, h('p.help', { id: 'srSame' }", "if (false) add(out, h('p.help', { id: 'srSame' }"),
 ("a stretch left out is not marked as one", SE, "dataset: { wave: w.k + 1, state: 'covered' } }", "dataset: { wave: w.k + 1, state: 'left' } }"),
 ("half the amount counts as a full week", SE, "q >= asked * (1 - S.NEAR) ? 'full'", "q >= asked * 0.5 ? 'full'"),
 ("the form opens on no amount", SE, "Object.assign(P, { hFrom: E.d2s(a), hTo: E.d2s(z), want: round(want), hFor: crop.id });", "Object.assign(P, { hFrom: E.d2s(a), hTo: E.d2s(z), want: '', hFor: crop.id });"),
 ("the form opens a fortnight apart whatever the crop", SE, "P.hEvery = here.error ? soonest.every : here.every;", "P.hEvery = 14;"),
 ("the summary leaves out the feet", SE, "${z && z.feet > 0 ? `, ${num(Math.round(z.feet))} ft of bed in all` : ''}", ""),
 ("the lines do not say what was wanted", SE, "z ? h('small.sr-asked',", "false ? h('small.sr-asked',"),
 ("the short weeks are never named", SE, "short.length ? h('p.help', { id: 'srShort' },", "false ? h('p.help', { id: 'srShort' },"),
 ("the count of full weeks is of the weeks now", SE, "${num(count('was'))} now, ${num(count('will'))} with these,", "${num(count('was'))} now, ${num(count('was'))} with these,"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
copy = scratch / "mutant"; caught, missed, broken = [], [], []
for name, rel, old, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("thumbs.json", "farm-map.jpg", "dev")) if mode == "node" else shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(old) != 1: broken.append((name, f"the text to change is there {s.count(old)} times")); print(f"BROKEN {name} :: {broken[-1][1]}", flush=True); continue
        f.write_text(s.replace(old, new), encoding="utf-8")
    if mode == "node":
        out = subprocess.run(["node", str(tests / "stepF_test.cjs"), str(copy), str(plan)] + ([os.environ["OLD"]] if os.environ.get("OLD") else []), capture_output=True, text=True, timeout=300).stdout
    else:
        out = alone([sys.executable, "-I", str(tests / "stepF_check.py"), str(copy), str(scratch / "mutant-shots")], 400, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
    try:
        d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else x for x in d["failed"]]
    except Exception: names = ["(the test did not finish: " + out[-200:].replace("\n", " ") + ")"]
    real = [n for n in names if n != "the test ran to its end" and not n.startswith("(the test did not finish")]
    if name is None: already = unfaulted(real, bool(real) or not names); continue
    real = [n for n in real if already is not None and n not in already]
    (caught if real else missed).append((name, (real or names)[:2]))
    print(("caught " if real else "MISSED ") + name + " :: " + "; ".join((real or names)[:2])[:200] + (" (which fails with no fault in it too)" if names and not real else ""), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": [m[0] for m in missed], "broken": [b[0] for b in broken]}))
