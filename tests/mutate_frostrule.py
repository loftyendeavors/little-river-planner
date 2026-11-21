"""Deliberate faults for the frost rule (#100): a frost date never stops a planting; it is placed and marked quietly. Each is put into a
copy of the app folder, and a line that passed with no fault in it must fail: of succession_test.cjs or waiting_test.cjs (node: the
planner's own tests, seconds a fault) or of ahead_check.py (page: an opening's panel, the series and a waiting planting, about half a minute a fault).
usage: python3 -I mutate_frostrule.py <app-dir> <scratch-dir> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part"""
import json, os, shutil, signal, subprocess, sys, time
app, scratch, tests, plan = sys.argv[1:5]
rest = sys.argv[5:]; mode = rest.pop(0) if rest and rest[0] in ('node', 'page', 'list') else 'node'
only = rest
node_tests = [os.path.join(tests, 'succession_test.cjs'), os.path.join(tests, 'waiting_test.cjs')]
page_check = os.path.join(tests, 'ahead_check.py')
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
N, P = 'node', 'page'
SU, EN, AH, SR = 'js/succession.js', 'js/engine.js', 'js/ahead.js', 'js/series.js'
FAULTS = [
 # ── the pure logic (succession_test.cjs, waiting_test.cjs) ──
 (N, 'a frost date stops a planting again', SU, "SEASON_KINDS = ['field', 'closed', 'timing'];", "SEASON_KINDS = ['field', 'frost', 'closed', 'timing'];"),
 (N, 'a field day set by the last frost alone still stops a planting', SU, "SEASON_KINDS.includes(x.k) && !(x.k === 'field' && x.t === early));", "SEASON_KINDS.includes(x.k));"),
 (N, 'the engine never tells a field day set by the frost alone', EN, "return t && !fieldStartWarning(p, r, false) ? t : null;", "return null;"),
 (N, 'the engine takes every early field day for the frost', EN, "return t && !fieldStartWarning(p, r, false) ? t : null;", "return t;"),
 (N, 'the days the frost cuts off count as short', SU, "if (!(r.harvestDays >= need || (r.frostCut && r.frostCut.plannedDays >= need)))", "if (!(r.harvestDays >= need))"),
 (N, 'a typed day the frost leaves nothing on is refused', SU, "if (!(r.harvestDays > 0) && !(r.frostCut && E.validDate(asked)))", "if (!(r.harvestDays > 0))"),
 (N, 'a crop the frost leaves nothing of is offered on its own first day', SU, "if (!(r.harvestDays > 0) && !(r.frostCut && E.validDate(asked)))", "if (!(r.harvestDays > 0) && !r.frostCut)"),
 (N, 'a crop the frost cuts carries no note', SU, "    if (frost) base.frost = frost;\n", ""),
 (N, 'the last day offered runs into the frost', SU, "if (late && late.ok && !late.frost) latest = wanted;", "if (late && late.ok) latest = wanted;"),
 (N, 'a crop the frost cuts is sorted among those that fit whole', SU, "const band = t => (t.frost ? 8 : 0) + ", "const band = t => "),
 (N, 'a series holds back a planting the frost leaves nothing to pick', SU, "if (!(r.harvestDays > 0) && !(r.frostCut && !sized))", "if (!(r.harvestDays > 0))"),
 (N, 'a series does not mark what the frost touches', SU, "unit: y ? y.unit : '', frost: frostNote(probe, p, r) });", "unit: y ? y.unit : '', frost: null });"),
 (N, 'a series counts every planting as crossing a frost date', SU, "frost: all.filter(x => x.frost).length,", "frost: all.length,"),
 (N, 'a waiting planting is not offered a bed the frost touches', SU, "if (res.state !== 'ok' || !res.r || seasonTrouble(eng, res.p, res.r) ||", "if (res.state !== 'ok' || !res.r || seasonTrouble(eng, res.p, res.r) || frostNote(eng, res.p, res.r) ||"),
 (N, 'a waiting planting’s home carries no frost mark', SU, "wanted: rank(bed) < 1e6, frost: frostNote(eng, res.p, res.r) });", "wanted: rank(bed) < 1e6, frost: null });"),
 (N, 'where a crop could go drops the frost note', SU, "spare: t.spare, frost: t.frost || null });", "spare: t.spare, frost: null });"),
 (N, 'the frost note is the first warning of any kind', SU, "const w = eng.warnings(p, r).find(x => x.k === 'frost');\n    return w ? w.t : eng.fieldFrostOnly(p, r);", "const w = eng.warnings(p, r)[0];\n    return w ? w.t : eng.fieldFrostOnly(p, r);"),
 (N, 'a series says the harvest of a planting that picks nothing', SU, "picked = all.filter(x => x.r.harvestDays > 0);", "picked = all;"),
 # ── the page (ahead_check.py) ──
 (P, 'a series of nothing picked still gives a harvest span', SR, "${n ? (result.firstHarvest ? ` Harvest", "${n ? (true ? ` Harvest"),
 (P, 'a row of a series says pick where nothing is picked', SR, "${first.r.harvestDays > 0 ? `pick ${day(first.r.first)}` : 'nothing picked'}", "pick ${day(first.r.first)}"),
 (P, 'the chip of a crop the frost cuts is not marked', AH, "t.frost ? h('small.ah-frost', { dataset: { hook: 'fit-frost-mark' } }, frostMark(t)) : null", "null"),
 (P, 'the chip says the planned days, not what the frost leaves', AH, "`frost: ${num(t.r.harvestDays)} of ${num(t.r.frostCut.plannedDays)} days`", "`frost: ${num(t.r.frostCut.plannedDays)} of ${num(t.r.frostCut.plannedDays)} days`"),
 (P, 'the chip’s title leaves out the frost note', AH, "${t.frost ? ` ${plain(t.frost)}` : ''}`,", "`,"),
 (P, 'the review has no frost line', AH, "const frost = t.ok && t.frost ? h('p.help.ah-frost',", "const frost = false ? h('p.help.ah-frost',"),
 (P, 'the frost line gives its days as 2027-10-18', AH, "dataset: { hook: 'opening-frost' } }, plain(t.frost))", "dataset: { hook: 'opening-frost' } }, t.frost)"),
 (P, 'Add planting is off where the frost touches it', AH, "id: 'ahAdd', disabled: !t.ok,", "id: 'ahAdd', disabled: !t.ok || !!t.frost,"),
 (P, 'the series does not say how many cross a frost date', SR, "result.frost ? h('span.sr-frost',", "false ? h('span.sr-frost',"),
 (P, 'a waiting planting’s homes are not marked', SR, "x.frost ? h('small.frost', { dataset: { hook: 'home-frost' }, title: plain(x.frost) }, 'frost') : null", "null"),
]
if mode == 'list': print(json.dumps({k: len([f for f in FAULTS if f[0] == k]) for k in (N, P)})); sys.exit(0)
faults = [f for f in FAULTS if f[0] == mode and (not only or any(word in f[1] for word in only))]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
caught, missed, broken = [], [], []
for kind, name, rel, a, b in ([(mode, None, None, None, None)] if faults else []) + faults:
    work = os.path.join(scratch, 'mutant')
    shutil.rmtree(work, ignore_errors=True); shutil.copytree(app, work)
    if name is not None:
        p = os.path.join(work, rel); s = open(p, encoding='utf-8').read()
        if s.count(a) != 1: broken.append(name); print('BROKEN [' + kind + '] ' + name + ': the text to change is there %d times' % s.count(a), flush=True); continue
        open(p, 'w', encoding='utf-8').write(s.replace(a, b))
    if kind == N:
        # both checks of the pure logic: the lines that fail in either, named by their check
        tail = {'failed': []}
        for test in node_tests:
            run = subprocess.run(['node', test, work, plan], capture_output=True, text=True)
            try: got = json.loads(run.stdout.strip().split('\n')[-1])
            except Exception: got = {'failed': [], 'crash': (run.stderr or run.stdout)[-300:]}
            tail['failed'] += [os.path.basename(test) + ': ' + str(n) for n in got.get('failed') or []]
            if 'crash' in got: tail['crash'] = got['crash']
    else:
        out, err = alone([sys.executable, '-I', page_check, work, os.path.join(scratch, 'mutant-shots')], 900, env={**os.environ, 'STOP_AT_FAIL': '1'})
        try: tail = json.loads(out.strip().split('\n')[-1])
        except Exception: tail = {'failed': [], 'crash': (err or out)[-300:]}
    named = [str(n.get('name')) if isinstance(n, dict) else str(n) for n in tail.get('failed') or []]; named = [n for n in named if 'ran to its end' not in n]   # a check that only stops has named no line: that is not a catch
    if name is None: already = unfaulted(named, 'crash' not in tail); continue
    fails = len(named); named = [n for n in named if already is not None and n not in already]
    (caught if named else missed).append(name)
    print(('caught ' if named else 'MISSED ') + '[' + kind + '] ' + name + ': ' + ('; '.join(map(str, named[:2]))[:220] if named else '(only what fails with no fault in it too)' if fails else '(no line of the check failed)' if 'crash' not in tail else '(the check stopped and named no line) <<' + tail['crash'].replace(chr(10), ' ')[-260:]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(faults), 'caught': len(caught), 'missed': missed, 'broken': broken}))
