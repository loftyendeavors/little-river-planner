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
 ("a sowing put off leaves its planting where it was", "js/week.js", "const planting = withTask({ ...p, date: to }, 'delay', kind,", "const planting = withTask({ ...p }, 'delay', kind,"),
 ("put off a second time, the first day is forgotten", "js/week.js", "days = dayDiff(s2d(date), st.planned), first = st.delayedFrom || was;", "days = dayDiff(s2d(date), st.planned), first = was;"),
 ("potting up put off moves the planting", "js/week.js", "    if (!MOVES.includes(kind)) {\n      const own = d2s(st.own);", "    if (false) {\n      const own = d2s(st.own);"),
 ("hardening off put off moves nothing", "js/week.js", "const MOVES = ['sow', 'harden', 'field'];", "const MOVES = ['sow', 'field'];"),
 ("a day chosen for potting up stands though the plan moved under it", "js/week.js", "else if (put && !MOVES.includes(st.kind) && put.own === own) {", "else if (put && !MOVES.includes(st.kind)) {"),
 ("a skipped job that is recorded still says skipped", "js/week.js", "st.skipped = !st.done && !st.passed ? skipOf(p, st.kind) : null;", "st.skipped = skipOf(p, st.kind);"),
 ("recorded work can be put off", "js/week.js", "    if (st.done) throw new Error(`This ${SL.DONE_WORD[kind] || 'work'} is already recorded, on ${st.done}.`);\n    if (!isDay(date)) throw new Error('Choose a real calendar date.');\n    const was", "    if (!isDay(date)) throw new Error('Choose a real calendar date.');\n    const was"),
 ("a job can be put off out of the plan's year", "js/week.js", "if (to.slice(0, 4) !== String(p.date).slice(0, 4)) throw", "if (false) throw"),
 ("a put-off with half its days is read as one", "js/week.js", "return x && isDay(x.from) && isDay(x.to) ? x : null; };", "return x && isDay(x.from) ? x : null; };"),
 ("a note cleared is kept as an empty one", "js/week.js", "if (value == null || value === '') delete group[kind]; else group[kind] = value;", "if (value == null) delete group[kind]; else group[kind] = value;"),
 ("a skip with no real day is kept", "js/week.js", "    if (day != null && !isDay(day)) throw new Error('Choose a real calendar date.');\n    return withTask(p, 'skip', kind, day);", "    return withTask(p, 'skip', kind, day);"),
 ("a copy of a planting carries what was put off, skipped and noted", "js/rails.js", " delete next.standId; delete next.tasks; delete next.failed; }", " delete next.standId; delete next.failed; }"),
 ("a skipped job is still listed as open", "js/week.js", "const open = line.members.filter(m => !m.st.done && !m.st.passed && !m.st.skipped), dated", "const open = line.members.filter(m => !m.st.done && !m.st.passed), dated"),
]
PAGE = [
 ("the calendar does not say what a late job pushes", "js/sowview.js", "${!moved.length ? 'nothing moves' : pairs.length === 1", "${true ? 'nothing moves' : pairs.length === 1"),
 ("a late job recorded from the calendar pushes nothing", "js/sowview.js", "const items = t.items(), now = App.today(), before = where(items.map(i => i.id)), off = diff(date, t.due), unit = stockUnitOf(t);\n    const done = App.recordWork(items, { date, follow: true });", "const items = t.items(), now = App.today(), before = where(items.map(i => i.id)), off = diff(date, t.due), unit = stockUnitOf(t);\n    const done = App.recordWork(items, { date, follow: false });"),
 ("the plan of record is taken every time", "js/app.js", "const same = options.why ? kept.find(s => s.why === options.why) : null;", "const same = null;"),
 ("the plan of record is never taken", "js/app.js", "if (done && first) { done.planOfRecord = true; keepPlanOfRecord(before); }", "if (false) { done.planOfRecord = true; keepPlanOfRecord(before); }"),
 ("the calendar offers a day after today for a record", "js/sowview.js", "hi: mode === 'go' ? '9999-12-31' : mode === 'delay' ? last : now };", "hi: mode === 'go' ? '9999-12-31' : last };"),
 ("passed-over lines are drawn as waiting", "js/week.js", "const open = line.members.filter(m => !m.st.done && !m.st.passed && !m.st.skipped), dated", "const open = line.members.filter(m => !m.st.done && !m.st.skipped), dated"),
 ("the phone keeps the planner's other views", "css/app.css", "body.phone .views, body.phone .library,", "body.phone .library,"),
 ("on a phone a row's words run off the screen", "css/app.css", ".tk-sub { display: block; font-size: var(--type-13); color: var(--muted); overflow-wrap: anywhere; }", ".tk-sub { display: block; font-size: 13px; color: var(--muted); white-space: nowrap; }"),
 ("the printed sheet leaves the planner on the page", "css/app.css", ".wkp { white-space: normal;", ".wkp { white-space: pre-wrap;"),
 ("the schedule records the sowing without its seed", "js/panels.js", "!st.done && !st.passed && !st.seed && !open ? h('button.link.job-tick'", "!st.done && !st.passed && !open ? h('button.link.job-tick'"),
 ("unticking a done job does nothing", "js/sowview.js", ": App.takeBackWork(l.members.filter(m => m.st.done).map(m => ({ id: m.p.id, kind: l.kind })));", ": null;"),
 ("what is late is left off today's list", "js/sowview.js", "open: all.filter(t => isOpen(t) && (ui.day === now ? t.due <= now : ui.day > now && t.due === ui.day))", "open: all.filter(t => isOpen(t) && t.due === ui.day)"),
 ("a later week's sheet carries what is late", "js/sowview.js", "now === T.monday(App.today()) && earlier.length + earlierJobs.length ? [h('h2'", "earlier.length + earlierJobs.length ? [h('h2'"),
 ("a phone's opened row offers the map", "js/sowview.js", "isPhone() ? null : h('button.tk-link.map'", "false ? null : h('button.tk-link.map'"),
 ("a late tick is recorded today without asking its day", "js/sowview.js", "    if (t.due < now) { openPop('done', t); return; }\n", ""),
 ("a long run of late tasks is not folded", "js/sowview.js", "if (rows.length <= LATE_FOLD || ui.shown[id + ':late']) return group('Late', 'late', rows, stock, now);", "if (rows.length >= 0) return group('Late', 'late', rows, stock, now);"),
 ("the fold of late tasks keeps the oldest, not the latest", "js/sowview.js", "withShares(rows.slice(hidden), stock, now)];", "withShares(rows.slice(0, LATE_SHOWN), stock, now)];"),
 ("the calendar opens over the row it asks about", "js/sowview.js", "    if (row) { if (card.right + 12 + w <= W - 12) left = card.right + 12; else if (card.left - 12 - w >= 12) left = card.left - 12 - w; }\n", ""),
 ("the day a task was due is not marked in the calendar", "js/sowview.js", "due = p.mode === 'done' && !!t && k === t.due, cur", "due = false, cur"),
 ("a task can be put off to a day before today", "js/sowview.js", "mode === 'delay' ? (now > first ? now : first) : mode === 'all'", "mode === 'delay' ? first : mode === 'all'"),
 ("a task done on another day stays under Completed today", "js/sowview.js", "on: l.skipped || (l.state === 'done' ? l.doneOn : null),", "on: l.skipped || (l.state === 'done' ? App.today() : null),"),
 ("an early tick is asked its day", "js/sowview.js", "    if (t.due < now) { openPop('done', t); return; }\n", "    if (t.due !== now) { openPop('done', t); return; }\n"),
 ("the message leaves out what moved", "js/sowview.js", "      ...moved, off && !moved.length ? 'nothing else moves' : '',\n      done.held", "      off && !moved.length ? 'nothing else moves' : '',\n      done.held"),
 ("Escape leaves the calendar open", "js/sowview.js", "if (e.key === 'Escape') { if (ui.pop) closePop(); else if (ui.open)", "if (e.key === 'Escape') { if (ui.open)"),
 ("on a phone the calendar is a small box, not a sheet", "css/app.css", "body.phone .tk-pop { left: 0 !important; right: 0; top: auto !important; bottom: 0; width: auto;", "body.phone .tk-pop { right: 0; bottom: 0;"),
 ("on a phone both lists are shown at once", "css/app.css", "body.phone .tk-list.off { display: none; }", "body.phone .tk-list.off { display: block; }"),
 ("on a phone the week's arrows are too small for a thumb", "css/app.css", "body.phone .tk-step button { width: var(--control-phone); height: var(--control-phone); }", "body.phone .tk-step button { width: 25px; height: 28px; }"),
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
