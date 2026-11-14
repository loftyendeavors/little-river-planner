"""Deliberate faults for step 5a: each is put into a copy of the app, and a named check must fail.
usage: python3 -I mutate5a.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: every fault against step5a_test.cjs (a minute or two; give OLD=<dir of the previous js> so a fault that moves a date by itself is caught). page: faults against step5a_check.py (several minutes each). list: how many faults there are of each kind, and nothing else.
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
NODE = [
 ("early work pulls the planting too", "js/week.js", "if (!(days > 0)) return null;", "if (!days) return null;"),
 ("a push may leave the plan's year", "js/week.js", "return to.slice(0, 4) === String(p.date).slice(0, 4) ? { days, from: p.date, to } : { days, from: p.date, to: null };", "return { days, from: p.date, to };"),
 ("potting up pushes", "js/week.js", "const PUSHES = ['sow', 'harden'];", "const PUSHES = ['sow', 'potup', 'harden'];"),
 ("hardening off does not push", "js/week.js", "const PUSHES = ['sow', 'harden'];", "const PUSHES = ['sow'];"),
 ("follow: false is ignored", "js/week.js", "const push = input && input.follow === false ? null : SL.realDay(date)", "const push = SL.realDay(date)"),
 ("taking back does not put the planting back", "js/week.js", "    if (back) {\n      const planting = { ...result.planting, date: back.from };", "    if (false) {\n      const planting = { ...result.planting, date: back.from };"),
 ("taking back moves a planting he has moved since", "js/week.js", "return f && f.to === p.date ? f : null;", "return f || null;"),
 ("lateness forgets the push", "js/week.js", " + (st.pushed ? st.pushed.days : 0) : null;", " : null;"),
 ("a late sowing pushes past work already recorded", "js/week.js", "if (!PUSHES.includes(kind) || AFTER[kind].some(k => done(p, k))) return null;", "if (!PUSHES.includes(kind)) return null;"),
 ("the order of work is not checked", "js/week.js", "if (first && second && first > second) throw", "if (false) throw"),
 ("a day after today is recorded", "js/week.js", "if (date > ctx.today) throw new Error('Work that has not happened yet", "if (false) throw new Error('Work that has not happened yet"),
 ("a job is recorded twice", "js/week.js", "if (st.done) throw new Error(`This ${SL.DONE_WORD[kind]} is already recorded", "if (false) throw new Error(`This ${SL.DONE_WORD[kind]} is already recorded"),
 ("seed sown in the ground is listed as planting out", "js/week.js", "        if (seedInGround) continue;\n", ""),
 ("a planting line mixes gardens", "js/week.js", "const key = [section, vkey, iso, there ? r.g.id : ''].join('|');", "const key = [section, vkey, iso, ''].join('|');"),
 ("a line stands on the planned day though the work was done on another", "js/week.js", "iso = st.done || d2s(st.planned), there", "iso = d2s(st.planned), there"),
 ("a set sowing day survives the push", "js/week.js", "if (planting.sowOn) { follow.sowOn = planting.sowOn; delete planting.sowOn; }", "if (planting.sowOn) { follow.sowOn = planting.sowOn; }"),
 ("a set sowing day is not restored", "js/week.js", "if (back.sowOn) planting.sowOn = back.sowOn;", ""),
 ("a taken-back record still counts", "js/week.js", "return x.action === 'complete' ? x : null;", "if (x.action === 'complete') return x;"),
 ("nothing is ever passed over", "js/week.js", "st.passed = !st.done && AFTER[st.kind].some(k => done(p, k));", "st.passed = false;"),
 ("planting out a transplant goes to the seed library", "js/week.js", "if (st.seed) result = SL.recordSowing(engine, inventory, p, input, ctx);", "if (st.seed || kind === 'field') result = SL.recordSowing(engine, inventory, p, input, ctx);"),
 ("a sowing is dated without its seed", "js/week.js", "if (st.seed) result = SL.recordSowing(engine, inventory, p, input, ctx);", "if (false) result = SL.recordSowing(engine, inventory, p, input, ctx);"),
 ("a tray batch gets a planting-out job", "js/week.js", "if (r.rack) push('sow', r.planned);\n    else {", "if (r.rack) push('sow', r.planned);\n    {"),
 ("the push is not written in the history", "js/week.js", "history[last] = { ...history[last], follow };", ""),
 ("the engine ignores the day hardening off was done", "js/engine.js", "const planned = hardenPlanned(r), actual = planned ? doneOf(r.planting, 'harden') : null;", "const planned = hardenPlanned(r), actual = null;"),
 ("the engine ignores the day potting up was done", "js/engine.js", "const planned = potUpPlanned(r), actual = planned ? doneOf(r.planting, 'potup') : null;", "const planned = potUpPlanned(r), actual = null;"),
 ("the planned day of hardening off is the recorded one", "js/engine.js", "      return new Date(Math.max(r.sow, addDays(r.field, -nsHarden())));\n    }\n    // Tower", "      const a = doneOf(r.planting, 'harden'); return a ? s2d(a) : new Date(Math.max(r.sow, addDays(r.field, -nsHarden())));\n    }\n    // Tower"),
 ("hardening off moved by itself", "js/engine.js", "return new Date(Math.max(r.sow, addDays(r.field, -nsHarden())));", "return new Date(Math.max(r.sow, addDays(r.field, -nsHarden() - 1)));"),
 ("hardening off recorded leaves the seed counted as still to sow", "js/seedlib.js", "const SOWN_KINDS = ['sow', 'potup', 'harden', 'field', 'move', 'harvest', 'flip'];", "const SOWN_KINDS = ['sow', 'field', 'harvest', 'flip'];"),
 ("moving out is not a job", "js/week.js", "      push('move', engine.outPlanned(p, r));\n", ""),
 ("towers are hardened off", "js/engine.js", "if (!r || !r.sow || r.tw || r.established || !nsHarden() || r.field <= r.sow) return null;\n      return new Date(Math.max(r.sow", "if (!r || !r.sow || r.established || !nsHarden() || r.field <= r.sow) return null;\n      return new Date(Math.max(r.sow"),
]
PAGE = [
 ("the bar does not say what a late job pushes", "js/sowview.js", "pre && pre.moved.length ? h('label.sw-follow'", "false ? h('label.sw-follow'"),
 ("the follow box is ignored when recording", "js/sowview.js", "const done = App.recordWork(itemsOf(t), { date, follow: ui.follow });", "const done = App.recordWork(itemsOf(t), { date });"),
 ("the plan of record is taken every time", "js/app.js", "const same = options.why ? kept.find(s => s.why === options.why) : null;", "const same = null;"),
 ("the plan of record is never taken", "js/app.js", "if (done && first) { done.planOfRecord = true; keepPlanOfRecord(before); }", "if (false) { done.planOfRecord = true; keepPlanOfRecord(before); }"),
 ("a job is recorded on a day after today", "js/sowview.js", "disabled: later && !t.sow.length, onclick: () => (later ? planFor(fig) : record(fig))", "disabled: false, onclick: () => (later && t.sow.length ? planFor(fig) : record(fig))"),
 ("passed-over lines are drawn as waiting", "js/week.js", "const open = line.members.filter(m => !m.st.done && !m.st.passed), dated", "const open = line.members.filter(m => !m.st.done), dated"),
 ("the phone keeps the planner's other views", "css/app.css", "body.phone .views, body.phone .library,", "body.phone .library,"),
 ("on a phone a job row runs off the screen", "css/app.css", "body.phone table.sw { min-width: 0; table-layout: auto; display: block; }", "body.phone table.sw { table-layout: auto; display: block; }"),
 ("the printed sheet leaves the planner on the page", "css/app.css", ".wkp { white-space: normal;", ".wkp { white-space: pre-wrap;"),
 ("the schedule records the sowing without its seed", "js/panels.js", "!st.done && !st.passed && !st.seed && !open ? h('button.link.job-tick'", "!st.done && !st.passed && !open ? h('button.link.job-tick'"),
 ("Take back on a job line does nothing", "js/sowview.js", "const done = App.takeBackWork(line.members.filter(m => m.st.done).map(m => ({ id: m.p.id, kind: line.kind })));\n    const unit", "const done = null;\n    const unit"),
 ("the other jobs are left out of the earlier count", "js/sowview.js", "late = earlier.length + earlierJobs.length;", "late = earlier.length;"),
 ("the sheet prints the earlier jobs though they are folded", "js/sowview.js", "ui.earlier && earlier.length + earlierJobs.length ? [h('h2'", "earlier.length + earlierJobs.length ? [h('h2'"),
 ("a tap on the place leaves the phone's week", "js/sowview.js", "function showOnMap(m) { if (isPhone()) return; ", "function showOnMap(m) { "),
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
        out = subprocess.run(["node", str(tests / "step5a_test.cjs"), str(copy), str(plan)] + ([os.environ["OLD"]] if os.environ.get("OLD") else []), capture_output=True, text=True, timeout=300).stdout
    else:
        out = alone([sys.executable, "-I", str(tests / "step5a_check.py"), str(copy), str(scratch / "mutant-shots")], 1500, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
    try:
        d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else x for x in d["failed"]]
    except Exception: names = ["(the test did not finish: " + out[-200:].replace("\n", " ") + ")"]
    real = [n for n in names if n != "the test ran to its end" and not n.startswith("(the test did not finish")]
    if name is None: already = unfaulted(real, bool(real) or not names); continue
    real = [n for n in real if already is not None and n not in already]
    (caught if real else missed).append((name, (real or names)[:2]))
    print(("caught " if real else "MISSED ") + name + " :: " + "; ".join((real or names)[:2])[:230] + (" (which fails with no fault in it too)" if names and not real else ""), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": [m[0] for m in missed], "broken": [b[0] for b in broken]}))
