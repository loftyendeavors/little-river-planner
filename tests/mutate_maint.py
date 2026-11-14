"""Deliberate faults in the maintenance pass (0.20), one at a time. Each must be caught by a named line of maint_check.py
(about a minute each: the check stops at the first line that fails).
usage: python3 -I mutate_maint.py <app-dir> <scratch-dir> <maint_check.py> <plan.json> [page | list] [words…]     env FROM=, TO= to run a part
list: how many faults there are, and nothing else."""
import json, os, shutil, signal, subprocess, sys, time
app, scratch, page_check, plan = sys.argv[1:5]
rest = sys.argv[5:]; mode = rest.pop(0) if rest and rest[0] in ('page', 'list') else 'page'
only = rest
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
 ('a change is saved over a stored plan that would not open', 'js/store.js', "      if (held) { status('held'); return; }\n      if (backend === 'memory') { status('unsaved'); return; }\n      status('pending');", "      if (backend === 'memory') { status('unsaved'); return; }\n      status('pending');"),
 ('something stored that is not a plan is opened as one', 'js/app.js', "if (saved && !(typeof saved === 'object' && Array.isArray(saved.plantings) && Array.isArray(saved.beds) && Array.isArray(saved.gardens)))", "if (saved && !(typeof saved === 'object'))"),
 ('saving is not held when the stored plan cannot be opened', 'js/app.js', "      store.hold();\n      state.unreadable =", "      state.unreadable ="),
 ('an empty browser does not say it holds no plan', 'js/main.js', "$('firstRun').hidden = !show; $('firstRun').classList.toggle", "$('firstRun').hidden = true; $('firstRun').classList.toggle"),
 ('the strip does not go when a plan is opened', 'js/main.js', "show = App.state.ready && (App.isSample() || !!bad);", "show = App.state.ready;"),
 ('the sample is called saved once it has been changed', 'js/app.js', "    if (isSample() && info.state === 'saved') text = 'Sample plan';\n", ""),
 ('a crop grown nowhere opens the series tool with no garden', 'js/series.js', "P.gardenIds = (planted.length ? planted : gardens.slice(0, 1)).map(g => g.garden.id);", "P.gardenIds = planted.map(g => g.garden.id);"),
 ('a crop grown somewhere starts in the first garden instead of its own', 'js/series.js', "P.gardenIds = (planted.length ? planted : gardens.slice(0, 1)).map(g => g.garden.id);", "P.gardenIds = gardens.slice(0, 1).map(g => g.garden.id);"),
 ('the series tool opens on another crop when asked for one it does not plan', 'js/series.js', "if (asked && !seriesCrops(eng).includes(asked)) {", "if (false) {"),
 ('a cover crop planting offers a series', 'js/panels.js', "canSeries(eng, r.c) ? h('button.linkish', { type: 'button', id: 'fSeriesLink'", "true ? h('button.linkish', { type: 'button', id: 'fSeriesLink'"),
 ('the "Series" line of the how-to list breaks into pieces again', 'js/panels.js', "h('li', h('b', 'Series'), h('span', 'One crop every so many days: ',", "h('li', h('b', 'Series'), h('i', 'One crop every so many days: ',"),
 ('a folder with no plan in it stays connected', 'js/app.js', "    const name = f.name, broken = !!(f.conflict && f.conflict.broken);\n    await Folder.forget();", "    const name = f.name, broken = !!(f.conflict && f.conflict.broken);"),
 ('"Open my plan folder" works while a plan is open', 'js/app.js', "if (!isSample() && !state.unreadable) { toast('A plan is already open here. Backup has the folder choices.'); return false; }", ""),
 ('the folder route misses a plan this browser wrote itself', 'js/app.js', "    try { held = await Folder.read(); } catch (_) { held = null; }\n", "    try { held = f.conflict ? await Folder.read() : null; } catch (_) { held = null; }\n"),
 ('"Save now" downloads the sample while the stored plan is unreadable', 'js/app.js', "    if (state.unreadable) { toast('Not saved: the plan stored in this browser could not be opened and is kept as it is. The choices are at the top of the page.'); return null; }\n", ""),
 ('a backup is loaded over the unreadable plan without asking', 'js/app.js', "    if (state.unreadable) {\n      const ok = await UI.confirm({ title: 'Replace what is stored here?'", "    if (state.unreadable && false) {\n      const ok = await UI.confirm({ title: 'Replace what is stored here?'"),
 ('"Carry on from the plan shown" does not ask', 'js/app.js', "confirmLabel: 'Replace it', danger: true });\n    if (!ok) return false;\n    store.release(); state.unreadable = null;\n    store.save(state.plan); emit('plan');", "confirmLabel: 'Replace it', danger: true });\n    store.release(); state.unreadable = null;\n    store.save(state.plan); emit('plan');"),
 ('"Carry on from the plan shown" leaves saving held', 'js/app.js', "    if (!ok) return false;\n    store.release(); state.unreadable = null;\n    store.save(state.plan); emit('plan');", "    if (!ok) return false;\n    state.unreadable = null;\n    store.save(state.plan); emit('plan');"),
 ('"Download what is stored" gives the plan shown, not what is stored', 'js/app.js', "    const text = store && store.raw();\n    if (text == null)", "    const text = JSON.stringify(state.plan);\n    if (text == null)"),
 ('with a plan open the work area no longer fills the window', 'css/app.css', "body > .work { grid-row: 4; }", "body > .work { grid-row: 3; }"),
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
    out, err = alone([sys.executable, '-I', page_check, work, os.path.join(scratch, 'mutant-shots'), plan], 900, env={**os.environ, 'STOP_AT_FAIL': '1'})
    try: tail = json.loads(out.strip().split('\n')[-1])
    except Exception: tail = {'failed': [], 'crash': (err or out)[-300:]}
    named = [str(n.get('name')) if isinstance(n, dict) else str(n) for n in tail.get('failed') or []]; named = [n for n in named if 'ran to its end' not in n]   # a check that only stops has named no line: that is not a catch
    if name is None: already = unfaulted(named, 'crash' not in tail); continue
    fails = len(named); named = [n for n in named if already is not None and n not in already]
    (caught if named else missed).append(name)
    print(('caught ' if named else 'MISSED ') + name + ': ' + ('; '.join(map(str, named[:2]))[:200] if named else '(only what fails with no fault in it too)' if fails else '(no line of the check failed)' if 'crash' not in tail else '(the check stopped and named no line) <<' + tail['crash'].replace(chr(10), ' ')[-200:]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(faults), 'caught': len(caught), 'missed': missed, 'broken': broken}))
