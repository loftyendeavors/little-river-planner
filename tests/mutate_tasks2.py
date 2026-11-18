"""Deliberate faults for Tasks, part 2: a planting marked failed (js/engine.js failedOn, js/week.js fail, the panel), a day a year
before its plan refused (js/seedlib.js), and on Tasks Upcoming weeks, Trays to fill, Mark all done, the bed flag, a tick ahead
asked first and "Take back everything recorded…" (js/sowview.js, js/app.js). Each is put into a copy of the app folder, and a line
of the check that passed with no fault in it must fail.
usage: python3 -I mutate_tasks2.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: against failed_test.cjs (a second or two a fault).
page: against tasks2_check.py (about a minute a fault).
list: how many faults there are in each, and nothing else.
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
EN, WK, SLB, AP, SV, PN, TL, MG, RL, NS = "js/engine.js", "js/week.js", "js/seedlib.js", "js/app.js", "js/sowview.js", "js/panels.js", "js/timeline.js", "js/merge.js", "js/rails.js", "js/nursery.js"
NODE = [
 ("a failed planting is picked to its old last day", EN, "      if (lost && addDays(lost, -1) < last) last = addDays(lost, -1);\n", ""),
 ("a failed planting is picked on the day it failed as well", EN, "      if (lost && addDays(lost, -1) < last) last = addDays(lost, -1);", "      if (lost && lost < last) last = lost;"),
 ("a failed planting holds its bed to its old day", EN, "      return lost && addDays(lost, -1) < held ? addDays(lost, -1) : held;", "      return held;"),
 ("a failed planting still stands in its bed on the map", EN, "        return date <= (lost && addDays(lost, -1) < until ? addDays(lost, -1) : until);", "        return date <= until;"),
 ("a mark with no day of its own is read as a failure", EN, "return typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(v) && validDate(s2d(v)) ? s2d(v) : null; };", "return f ? s2d(v || '2027-01-01') : null; };"),
 ("a failed planting's work still to do stays on the list", WK, "    return engine.failedOn && engine.failedOn(p) ? out.filter(st => st.done) : out;", "    return out;"),
 ("a failed planting's recorded work leaves the list too", WK, "    return engine.failedOn && engine.failedOn(p) ? out.filter(st => st.done) : out;", "    return engine.failedOn && engine.failedOn(p) ? [] : out;"),
 ("a failed planting never sown still needs its seed", SLB, "      if (sown || (engine.failedOn && engine.failedOn(p))) continue;", "      if (sown) continue;"),
 ("a failed planting's sowing still counts its seed", SLB, "estimate: failed ? 0 : Math.max(", "estimate: Math.max("),
 ("the mark is not taken off, only emptied", WK, "    if (day == null) { const out = { ...p }; delete out.failed; return out; }", "    if (day == null) return { ...p, failed: {} };"),
 ("a mark is written without its moment", WK, "    return { ...p, failed: { on: day, at: String(at || '') } };", "    return { ...p, failed: { on: day } };"),
 ("a day that is no day is marked", WK, "    if (!isDay(day)) throw new Error('Choose a real calendar date.');\n    return { ...p, failed", "    return { ...p, failed"),
 ("the mark is joined key by key when two devices meet", MG, "'plantings[].tasks.delay.*', 'plantings[].failed', 'plantings[].towerCycle',", "'plantings[].tasks.delay.*', 'plantings[].towerCycle',"),
 ("a copy of a planting carries its mark", RL, "delete next.tasks; delete next.failed; }", "delete next.tasks; }"),
 ("a failed crate stays on the bench", EN, "const lost = failedOn(p), out = lost && lost < r.out ? lost : r.out, to =", "const out = r.out, to ="),
 ("a failed planting still starts its stand", EN, "const models = standMates(p).filter(q => q === p || !failedOn(q)), actual", "const models = standMates(p), actual"),
 ("a sowing a year before its plan is taken", SLB, "    const far = yearAway(date, s.planned);\n    if (far) throw new Error(far);\n", ""),
 ("another job a year before its day is taken", WK, "      const far = SL.yearAway(date, st.planned);\n      if (far) throw new Error(far);\n", ""),
 ("a day just inside the year is refused", SLB, "/ 864e5) < YEAR_DAYS) return '';", "/ 864e5) < YEAR_DAYS - 2) return '';"),
]
PAGE = [
 ("Upcoming weeks is not drawn", SV, "      upcoming(now),\n", ""),
 ("Upcoming weeks counts done tasks as well", SV, "const cur = T.monday(now), all = tasks().filter(isOpen);", "const cur = T.monday(now), all = tasks();"),
 ("Upcoming weeks starts at this week", SV, "const a = plus(cur, 7 * w), z = plus(a, 6), inWeek", "const a = plus(cur, 7 * (w - 1)), z = plus(a, 6), inWeek"),
 ("a press on a week opens its first day only", SV, "    else if (act === 'upweek') { viewWeek(el.dataset.week);", "    else if (act === 'upweek') { viewDay(el.dataset.week);"),
 ("Trays to fill counts trays shared by several sowings once for each", SV, "      if (groups.has(key)) continue;   // trays shared by several sowings are counted once\n", ""),
 ("Trays to fill stands under the lists", SV, "id === 'nursery' ? fillHead(s.open) : null, k ? dayBody", "null, k ? dayBody"),
 ("Upcoming weeks rounds every share of shared trays up", SV, "    const fig = fillFigures(list), trays = fig ? fig.trays : 0, by = new Map()", "    const trays = list.reduce((n, t) => n + (t.sow && t.id !== 'direct' ? whole(t.line.trays) : 0), 0), by = new Map()"),
 ("a failure may be marked after its bed was already free", AP, "hi = held !== Infinity && E.d2s(held) < today ? E.d2s(held) : today;", "hi = today;"),
 ("Mark all done is on a group of two", SV, "  const ALL_FROM = 3;", "  const ALL_FROM = 2;"),
 ("Mark all done on late tasks records today without asking", SV, "    if (list.some(t => t.due < now)) { openPop('all', null, el && el.id, list.map(t => t.key)); return; }", "    if (false) { openPop('all', null, el && el.id, list.map(t => t.key)); return; }"),
 ("each on its own day records them all today", SV, "items = list.flatMap(t => t.items().map(i => (each ? { ...i, date: t.due } : i)));", "items = list.flatMap(t => t.items());"),
 ("Mark all done's day says nothing of first harvests", SV, "firsts.length ? `${plural(firsts.length, 'first harvest')} ${firsts.length === 1 ? 'moves' : 'move'}` : ''", "''"),
 ("the bed flag gives the last day held as the day free", SV, "`Bed not free until ${shortDay(E.d2s(E.addDays(until, 1)))}`", "`Bed not free until ${shortDay(E.d2s(until))}`"),
 ("the bed flag is never shown", SV, "    return isOpen(t) ? shortText(t, stock) || bedText(t) : '';", "    return isOpen(t) ? shortText(t, stock) : '';"),
 ("a flag wraps onto a second line", "css/app.css", "white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 0; overflow: hidden; text-overflow: ellipsis; }", "white-space: normal; font-variant-numeric: tabular-nums; max-width: 120px; }"),
 ("a tick a week ahead records without asking", SV, "    if (diff(t.due, now) >= AHEAD_ASK) { openPop('ahead', t); return; }\n", ""),
 ("a tick three days ahead asks first", SV, "  const AHEAD_ASK = 7;", "  const AHEAD_ASK = 1;"),
 ("Not yet records it all the same", SV, "dataset: { close: '1', hook: 'tasks-ahead-no' } }, 'Not yet')", "dataset: { ahead: 'yes', hook: 'tasks-ahead-no' } }, 'Not yet')"),
 ("the take-back sheet does not count what was skipped", SV, "n.skips ? `${plural(n.skips, 'skipped task')} back on the list` : ''].filter(Boolean);", "''].filter(Boolean);"),
 ("Take back everything undoes what was put off before the late work under it", AP, "          if (standing) {", "          if (standing && false) {"),
 ("a failed planting's put-off is cleared and not taken back", AP, "      let p = p0.failed ? Week.fail(p0, null) : p0, inv = inventory,", "      let p = p0, inv = inventory,"),
 ("Take back everything clears the notes too", AP, "        for (const kind of Object.keys(t.skip || {})) { p = Week.withTask(p, 'skip', kind, null); back.skips++; }", "        for (const kind of Object.keys(t.skip || {})) { p = Week.withTask(p, 'skip', kind, null); back.skips++; }\n        delete p.tasks;"),
 ("Take back everything keeps no snapshot", AP, "    const kept = await snapshot(`Before everything recorded in ${year} was taken back`);\n    if (!kept && Snaps && !isSample()) { toast('The snapshot could not be kept, so nothing was taken back.'); return null; }\n", "    const kept = null;\n"),
 ("Take back everything is a step for each planting", AP, "    if (!commit(`Everything recorded in ${year} taken back`, ops, { unchecked: true })) return null;", "    for (const op of ops) commit(`Everything recorded in ${year} taken back`, [op], { unchecked: true });"),
 ("Mark as failed is offered before a planting has started", AP, "    return lo <= hi ? { lo, hi } : null;", "    return { lo, hi: hi < lo ? lo : hi };"),
 ("marking failed says nothing of the forecast first", PN, "x.units > 0 ? `${F.amount(x.units, x.unit, 'produce')} comes off the forecast", "false ? `${F.amount(x.units, x.unit, 'produce')} comes off the forecast"),
 ("the panel's day for a failure opens on its start", PN, "h('input', { type: 'date', value: range.hi, min: range.lo,", "h('input', { type: 'date', value: range.lo, min: range.lo,"),
 ("a failed planting is not greyed on the Timeline", TL, "(r.failed ? '.tl-failed' : '')", "''"),
 ("Take the mark off is not on the panel", PN, "dataset: { hook: 'panel-failed-back' }, onclick", "hidden: true, dataset: { hook: 'panel-failed-back' }, onclick"),
 ("two jobs of one planting in one step: the later is worked on the plan as it was, and the first is lost", AP, "      const was = at.has(item.id) ? ops[at.get(item.id)].after : state.engine.planting(item.id);", "      const was = state.engine.planting(item.id);"),
 ("two jobs of one planting in one step give two changes, and the second undoes the first", AP, "        if (at.has(item.id)) ops[at.get(item.id)].after = result.planting; else { at.set(item.id, ops.length); ops.push({ before: was, after: result.planting }); }", "        at.set(item.id, ops.length); ops.push({ before: was, after: result.planting });"),
 ("a planting with two of its jobs in one step has its first harvest said twice", AP, "      for (const id of new Set(done.map(r => r.id))) {", "      for (const id of done.map(r => r.id)) {"),
 ("a failure may be marked before the last work recorded on it", AP, "    const lo = days.length && days[days.length - 1] > first ? days[days.length - 1] : first;", "    const lo = first;"),
 ("the panel's sowing calendar goes back further than a year", PN, "min: E.validDate(s.planned) ? E.d2s(E.addDays(s.planned, 1 - SL.YEAR_DAYS)) : undefined,", "min: undefined,"),
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
copy = scratch / "mutant-tasks2"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone(["node", str(tests / "failed_test.cjs"), str(copy), str(plan)], 120)[0] if mode == "node" else alone([sys.executable, "-I", str(tests / "tasks2_check.py"), str(copy), str(scratch / "mutant-tasks2-shots")], 900)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
