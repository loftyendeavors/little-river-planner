"""Deliberate faults in the timeline, one at a time, each of which step2a_check.py must catch.
usage: python3 -I mutate2a.py <app-dir> <scratch-dir> <step2a_check.py> [page | list] [words…]     env FROM=, TO= to run a part
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
 ('the plain wheel zooms again instead of scrolling the rows', 'js/timeline.js', "      if (!e.ctrlKey || !inLanes(e)) return;", "      if (!inLanes(e)) return;"),
 ('Ctrl and the wheel do nothing', 'js/timeline.js', "      if (!e.ctrlKey || !inLanes(e)) return;", "      if (e.ctrlKey || !inLanes(e)) return;"),
 ('labels are not fitted again when the scale changes', 'js/timeline.js', "  function refit() { for (const fit of fitList) fit(); }", "  let fitted = false;\n  function refit() { if (fitted) return; fitted = true; for (const fit of fitList) fit(); }"),
 ('the day under the pointer is not kept', 'js/timeline.js', "    scroll.scrollLeft = Math.max(0, dayAt * ppd - offset);", "    scroll.scrollLeft = Math.max(0, dayAt * ppd - offset * 0.9);"),
 ('each step of the wheel works from the rounded scroll position', 'js/timeline.js', "    const dayAt = same ? held.day : (scroll.scrollLeft + offset) / ppd;", "    const dayAt = (scroll.scrollLeft + offset) / ppd;"),
 ('towers of different varieties are merged', 'js/timeline.js', "const k = [item.p.cropId, item.p.varietyId || '', item.from, item.to, item.ghost ? 'ghost' : ''].join('|');", "const k = [item.p.cropId, item.from, item.ghost ? 'ghost' : ''].join('|');"),
 ('tunnels are filed under Field', 'js/timeline.js', "return eng.isSoilBed(bed) && garden.type === 'field' ? 'field' : 'cover';", "return eng.isSoilBed(bed) ? 'field' : 'cover';"),
 ('a bar is a day short', 'css/app.css', ".tl-bar { left: calc(var(--a) * var(--ppd) * 1px); width: max(4px, calc(var(--n) * var(--ppd) * 1px)); }", ".tl-bar { left: calc(var(--a) * var(--ppd) * 1px); width: max(4px, calc((var(--n) - 1) * var(--ppd) * 1px)); }"),
 ('the widest view is wider than the page', 'js/timeline.js', "  const fitPpd = () => laneRoom() / yearDays();", "  const fitPpd = () => 1.15 * laneRoom() / yearDays();"),
 ('the tray strip adds the week up', 'js/timeline.js', "for (let k = i; k <= j; k++) most = Math.max(most, load[k]);", "for (let k = i; k <= j; k++) most += load[k];"),
 ('a long bar loses its name off the left', 'css/app.css', ".tl-name { position: sticky; left: 148px; display: inline-block; max-width: 100%; vertical-align: top; }", ".tl-name { display: inline-block; max-width: 100%; vertical-align: top; }"),
 ('selecting draws the whole chart again', 'js/timeline.js', "      markSel();\n    });", "      render();\n    });"),
 ('an opening always says its days in full', 'js/timeline.js', "label = measure('open', full) + OPEN_PAD <= w ? full : measure('open', short) + OPEN_PAD <= w ? short : '';", "label = full;"),
 ('live trays show under a filter', 'js/timeline.js', "    for (const s of all ? SECTIONS : [prefs.filter]) {", "    for (const s of all ? SECTIONS : [prefs.filter, 'trays']) {"),
 ('a crate month is split by variety', 'js/timeline.js', "for (const item of list) { const k = String(item.from) + (item.ghost ? '|ghost' : ''); if (!merged.has(k))", "for (const item of list) { const k = String(item.from) + (item.p.varietyId || '') + (item.ghost ? '|ghost' : ''); if (!merged.has(k))"),
 ('a drop lands a day late', 'js/timeline.js', "dayIndex = Math.floor((cx - lane.left) / ppd) - grabDays;\n    if (dayIndex < 0", "dayIndex = Math.floor((cx - lane.left) / ppd) - grabDays + 1;\n    if (dayIndex < 0"),
 ('the filter is not remembered', 'js/timeline.js', "    prefs.filter = id; savePrefs();\n", "    prefs.filter = id;\n"),
 ('dragging empty chart moves it sideways only', 'js/timeline.js', "      scroll.scrollLeft = pan.left - dx; scroll.scrollTop = pan.top - dy;", "      scroll.scrollLeft = pan.left - dx;"),
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
