"""Deliberate faults in the whole-season map and the lot line, one at a time, each of which fixes_018_check.py must catch.
usage: python3 -I mutate018.py <app-dir> <scratch-dir> <fixes_018_check.py> [page | list] [words…]     env FROM=, TO= to run a part
page: every fault against the check (a minute or two each). list: how many faults there are, and nothing else."""
import json, os, shutil, signal, subprocess, sys, time
app, scratch, check = sys.argv[1:4]
rest = sys.argv[4:]; mode = rest.pop(0) if rest and rest[0] in ('page', 'list') else 'page'
only = rest   # optional: words that pick out the faults to try
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
FAULTS = [
 ('a space is counted twice for a crop that returns to it', 'js/map.js', "      for (const id of new Set(runs.map(x => x.c.id))) counts.set(id, (counts.get(id) || 0) + 1);", "      for (const id of runs.map(x => x.c.id)) counts.set(id, (counts.get(id) || 0) + 1);"),
 ('the first crop is at the bed\'s own starting end, wherever that points', 'js/map.js', "flip = -Math.sin(turn) + Math.cos(turn) > 0;", "flip = false;"),
 ('every band is the same size', 'js/map.js', "    for (const run of runs) run.part = run.weight / total;", "    for (const run of runs) run.part = 1 / runs.length;"),
 ('the season view is drawn again for every day', 'js/map.js', "    App.on('date', () => { if (!wholeSeason) paint(); });", "    App.on('date', paint);"),
 ('pots and crates are listed in runs, not by crop', 'js/map.js', "byCrop = eng.isCt(bed) || eng.isRack(bed), runs = [];", "byCrop = false, runs = [];"),
 ('a click on a band selects a planting', 'js/map.js', "attrs = { fill: color, class: 'bed-fill pick season', 'data-crop': run.c.id }", "attrs = { fill: color, class: 'bed-fill pick season', 'data-crop': run.c.id, 'data-planting': run.list[0].id }"),
 ('the lot line is built again on every redraw', 'js/seeds.js', "const line = lotRow.node && lotRow.node.dataset.lotFor === v.id ? lotRow.node : (lotRow.node = lotLine(v, cols, flat));", "const line = lotRow.node = lotLine(v, cols, flat);"),
 ('the cursor is lost when the list is drawn again', 'js/seeds.js', "    if (typing && !lotRow.focus) lotRow.focus = typing;", ""),
 ('Escape does not close the lot line', 'js/seeds.js', "onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLotRow(); } } },", "},"),
 ('a lot added under a row is always on hand', 'js/seeds.js', "unit, status: lotRow.status }, ctx); }", "unit, status: 'usable' }, ctx); }"),
 ('the lot line sits to the left of its variety', 'css/app.css', "#sdBody tr.sd-lotrow > td { padding: 0 12px 10px 78px;", "#sdBody tr.sd-lotrow > td { padding: 0 12px 10px 8px;"),
 ('the lot line stays open after a lot is added', 'js/seeds.js', "    Object.assign(lotRow, { varietyId: '', amount: '', focus: '', node: null });\n    ui.sel = { type: 'variety', id: v.id }; ui.panelKey = ''; schedule();", "    ui.sel = { type: 'variety', id: v.id }; ui.panelKey = ''; schedule();"),
]
if mode == 'list': print(json.dumps({'page': len(FAULTS)})); sys.exit(0)
faults = [f for f in FAULTS if not only or any(word in f[0] for word in only)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
caught, missed, broken = [], [], []
for name, rel, a, b in ([(None, None, None, None)] if faults else []) + faults:
    work = os.path.join(scratch, 'mutant')
    shutil.rmtree(work, ignore_errors=True); shutil.copytree(app, work)
    if name is not None:
        p = os.path.join(work, rel); s = open(p, encoding='utf-8').read()
        if s.count(a) != 1: broken.append(name); print('BROKEN ' + name + ': the text to change is there %d times' % s.count(a), flush=True); continue
        open(p, 'w', encoding='utf-8').write(s.replace(a, b))
    out, err = alone([sys.executable, '-I', check, work, os.path.join(scratch, 'mutant-shots')], 900)
    try: tail = json.loads(out.strip().split('\n')[-1])
    except Exception: tail = {'failed': [], 'crash': (err or out)[-300:]}
    named = [str(n.get('name')) if isinstance(n, dict) else str(n) for n in tail.get('failed') or []]; named = [n for n in named if 'ran to its end' not in n]   # a check that only stops has named no line: that is not a catch
    if name is None: already = unfaulted(named, 'crash' not in tail); continue
    fails = len(named); named = [n for n in named if already is not None and n not in already]
    (caught if named else missed).append(name)
    print(('caught ' if named else 'MISSED ') + name + ': ' + ('; '.join(map(str, named[:2]))[:200] if named else '(only what fails with no fault in it too)' if fails else '(no line of the check failed)' if 'crash' not in tail else '(the check stopped and named no line) <<' + tail['crash'].replace(chr(10), ' ')[-260:]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(faults), 'caught': len(caught), 'missed': missed, 'broken': broken}))
