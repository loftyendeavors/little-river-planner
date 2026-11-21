"""Deliberate faults for a run of successions (E4, stage 1). Each is put into a copy of the app folder, and a line that passed with
no fault in it must fail: of run_test.cjs (node: the solver, LRFSuccession.planRun, seconds a fault) or of run_check.py (page: the
steps LRFApp.addRun and LRFApp.removeRun, half a minute a fault). The faults of the joins are in mutate_merge.py, those of the
plan's shape in mutate_shape.py.
usage: python3 -I mutate_runs.py <app-dir> <scratch-dir> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part"""
import json, os, shutil, signal, subprocess, sys, time
app, scratch, tests, plan = sys.argv[1:5]
rest = sys.argv[5:]; mode = rest.pop(0) if rest and rest[0] in ('node', 'page', 'list') else 'node'
only = rest
node_test = os.path.join(tests, 'run_test.cjs')
page_check = os.path.join(tests, 'run_check.py')
def alone(cmd, timeout, env=None, cwd=None):
    """Runs one check in a process group of its own. When it is done or out of time, that group is stopped, and so is whatever it
    started and left behind (known by a mark put in its environment): its own browsers and services, and nobody else's."""
    mark = "LRF_FAULT_RUN=%d.%d" % (os.getpid(), time.time_ns())
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd, env={**(env or os.environ), **dict([mark.split("=")])}, start_new_session=True)
    try: out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGTERM)
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
N, P = 'node', 'page'
SU, AP = 'js/succession.js', 'js/app.js'
FAULTS = [
 # ── the solver (run_test.cjs) ──
 (N, 'a sowing may take part of a bed', SU, "if (!(res.r.tw || res.r.physicalLength >= res.r.cap - EPS)) return", "if (false) return"),
 (N, 'a frost date stops a sowing', SU, "    const trouble = seasonTrouble(probe, res.p, res.r);\n", "    const trouble = seasonTrouble(probe, res.p, res.r) || frostNote(probe, res.p, res.r);\n"),
 (N, 'a run holds back a sowing the frost leaves nothing to pick', SU, "if (!(res.r.harvestDays > 0) && !res.r.frostCut) return { why: 'Nothing would be ready before the season ends' };", "if (!(res.r.harvestDays > 0)) return { why: 'Nothing would be ready before the season ends' };"),
 (N, 'a run counts every sowing as crossing a frost date', SU, "frost: list.filter(x => x.frost).length },", "frost: list.length },"),
 (N, 'a sowing the frost touches is not marked', SU, "frost: frostNote(probe, p, r) || null });", "frost: null });"),
 (N, 'field dates and closed houses no longer stop a sowing', SU, "    const trouble = seasonTrouble(probe, res.p, res.r);\n", "    const trouble = null;\n"),
 (N, 'two sowings may take the same ground', SU, "      work = { ...work, plantings: [...work.plantings, p] };\n      probe = E.create(work, eng.lib, PROBE);", "      work = { ...work, plantings: [...work.plantings, p] };"),
 (N, 'the solver writes into the plan it is given', SU, "      work = { ...work, plantings: [...work.plantings, p] };\n      probe = E.create(work, eng.lib, PROBE);", "      work.plantings.push(p); work = { ...work };\n      probe = E.create(work, eng.lib, PROBE);"),
 (N, 'picking dates are not dated back', SU, "      date = E.addDays(target, -E.dayDiff(first.r.first, first.r.field));   // dated back", "      date = target;   // dated back"),
 (N, 'a trial planting does not carry its spacing', SU, "run: { id: o.record.id, n, gap } }", "run: { id: o.record.id, n } }"),
 (N, 'what has no bed is not told the gardens that have room', SU, "...(say ? { room: roomElse(probe, o, target) } : {})", "...(say ? { room: [] } : {})"),
 (N, 'the beds named are not taken in their order', SU, "if (bedIds.length) bedIds.map(id => eng.bedOf(id)).forEach(take);", "if (bedIds.length) bedIds.slice().reverse().map(id => eng.bedOf(id)).forEach(take);"),
 (N, 'the gardens for when room runs out come first', SU, "list.push({ bed: b, then: true }); }", "list.unshift({ bed: b, then: true }); }"),
 (N, 'the overshoot is not said', SU, "last && last.lastPick > z ?", "last && last.lastPick > E.addDays(z, 400) ?"),
 (N, 'the overshoot is said for planting dates by beds too', SU, "const asksPicking = o.datesFor === 'picking' || o.by === 'amount';", "const asksPicking = true;"),
 (N, 'an amount is met with less than it on average', SU, "enough: run >= need - EPS }", "enough: run >= need * 0.75 }"),
 (N, 'the spacing found is not the widest that gives enough', SU, "if (at(mid).enough) good = mid; else bad = mid;", "bad = mid;"),
 (N, 'what the plan already gives is taken off the amount', SU, "need: wanted, short", "need: wanted == null ? null : Math.max(0, wanted - have), short"),
 (N, 'a week is judged short on what the plan gives with the run', SU, "short: wanted != null && run < wanted * (1 - NEAR) };", "short: wanted != null && have + run < wanted * (1 - NEAR) };"),
 (N, 'the margin is not added', SU, "wanted: want == null ? null : want * (1 + margin / 100)", "wanted: want == null ? null : want"),
 (N, 'a yield nobody has checked plans an amount', SU, "      if (rests.open) return { unchecked: true, error: openWhy(o.crop) };\n", ""),
 (N, 'the short weeks are not named', SU, "short: weeks.weeks.filter(w => w.short)", "short: []"),
 (N, 'a run may make sizes of a sowing', SU, "if (reach !== 'spacing') return", "if (reach === 'none') return"),
 (N, 'a copy of a planting of a run stays in the run', 'js/rails.js', "delete next.run; delete next.startedFrom; }", "delete next.startedFrom; }"),
 # ── the steps (run_check.py) ──
 (P, 'adding a run leaves its record out', AP, "[...ps.map(p => ({ before: null, after: p })), runsOp([...runs(), result.run])]", "ps.map(p => ({ before: null, after: p }))"),
 (P, 'adding a run is not held to the guard rails', AP, "runsOp([...runs(), result.run])]);\n  }", "runsOp([...runs(), result.run])], { unchecked: true });\n  }"),
 (P, 'the same run can be added twice', AP, "    if (runs().some(r => r.id === result.run.id)) return refuse('That run is already in the plan.');\n    const ps = result.sowings.map(s => s.p);\n    if (ps.some(p => !p || !p.run || p.run.id !== result.run.id || state.engine.planting(p.id))) return", "    const ps = result.sowings.map(s => s.p);\n    if (false) return"),
 (P, 'a run taken out leaves its mark on its plantings', AP, "const after = { ...before }; delete after.run; return { before, after };", "return { before, after: before };"),
 (P, 'a run taken out with its plantings leaves them', AP, "if (options.plantings) return { before, after: null };", "if (false) return { before, after: null };"),
 (P, 'a run taken out leaves an empty list behind', AP, "after: after.length ? after : null });\n  /**\n   * Add a run", "after });\n  /**\n   * Add a run"),
]
if mode == 'list': print(json.dumps({k: len([f for f in FAULTS if f[0] == k]) for k in (N, P)})); sys.exit(0)
faults = [f for f in FAULTS if f[0] == mode and (not only or any(word in f[1] for word in only))]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
def unfaulted(names, ran):
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
caught, missed, broken, already = [], [], [], None
for kind, name, rel, a, b in ([(mode, None, None, None, None)] if faults else []) + faults:
    work = os.path.join(scratch, 'mutant')
    shutil.rmtree(work, ignore_errors=True); shutil.copytree(app, work)
    if name is not None:
        p = os.path.join(work, rel); s = open(p, encoding='utf-8').read()
        if s.count(a) != 1: broken.append(name); print('BROKEN [' + kind + '] ' + name + ': the text to change is there %d times' % s.count(a), flush=True); continue
        open(p, 'w', encoding='utf-8').write(s.replace(a, b))
    if kind == N:
        run = subprocess.run(['node', node_test, work, plan], capture_output=True, text=True, timeout=600)
        try: tail = json.loads(run.stdout.strip().split('\n')[-1])
        except Exception: tail = {'failed': [], 'crash': (run.stderr or run.stdout)[-300:]}
    else:
        out, err = alone([sys.executable, '-I', page_check, work, os.path.join(scratch, 'mutant-shots')], 600)
        try: tail = json.loads(out.strip().split('\n')[-1])
        except Exception: tail = {'failed': [], 'crash': (err or out)[-300:]}
    named = [str(n.get('name')) if isinstance(n, dict) else str(n) for n in tail.get('failed') or []]; named = [n for n in named if not n.startswith('(the test stopped')]   # a check that only stops has named no line
    if name is None: already = unfaulted(named, 'crash' not in tail); continue
    fails = len(named); named = [n for n in named if already is not None and n not in already]
    (caught if named else missed).append(name)
    print(('caught ' if named else 'MISSED ') + '[' + kind + '] ' + name + ': ' + ('; '.join(map(str, named[:2]))[:220] if named else '(only what fails with no fault in it too)' if fails else '(no line of the check failed)' if 'crash' not in tail else '(the check stopped and named no line) <<' + tail['crash'].replace(chr(10), ' ')[-260:]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(faults), 'caught': len(caught), 'missed': missed, 'broken': broken}))
