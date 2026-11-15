"""Deliberate faults in what keeps two windows of one browser from losing a change, and a stored plan that is behind from being
sent: each takes one guard out of a copy of the code, and a named line of a check must then fail where it passed before.

usage: python3 -I mutate_windows.py <app-dir> <repo-dir> <scratch-dir> <tests-dir> [node | page | list] [words...]     env FROM=, TO= to run a part

node faults (seconds each) are put into js/store.js or js/sync.js and run against tests/store_test.cjs and
tools/sync_client_test.mjs. page faults (under a minute each) are put into a copy of the app folder and run against
tests/two_windows_check.py in a real browser. list: how many faults there are of each kind, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
app, repo, scratch, tests = sys.argv[1:5]
mode = sys.argv[5] if len(sys.argv) > 5 else 'node'; words = [w.lower() for w in sys.argv[6:]]
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

# (the guard taken out, file, as it is, as the fault has it, words of the line that must fail)
NODE = [
  ('a page that finds the lock taken gives up at once: a reload can leave the one window read-only', 'js/store.js',
   "if (!lock && ++tries < AGAIN) { setTimeout(ask, 150); return undefined; }", "", 'still letting go of the lock'),
  ('the count beside the stored plan is not checked before a write', 'js/store.js',
   "      if (countNow() !== count) { stop('changed'); return false; }\n", "", 'a moved count refuses the write'),
  ('the plan is written before the count', 'js/store.js',
   "      root.localStorage.setItem(COUNT_KEY, String(count + 1)); count += 1;\n      root.localStorage.setItem(DEVICE_KEY, text);\n",
   "      root.localStorage.setItem(DEVICE_KEY, text);\n      root.localStorage.setItem(COUNT_KEY, String(count + 1)); count += 1;\n", 'the count is written before the plan'),
  ('a stored plan whose count is under the one noted is taken for a plan changed here', 'js/sync.js',
   "(Number.isInteger(cfg.n) && s.n < cfg.n) || ", "", 'a plan behind by its count, then a new start'),
  ('a plan that was sent and never stored: the older one found at the next start is taken for a plan changed here', 'js/sync.js',
   "(cfg.stored === false && host.key() !== cfg.key)", "false", 'a refused save, then a new start'),
]
PAGE = [
  ("the lock's answer is ignored: a second window takes changes like the first", 'js/store.js',
   "              if (!lock) { stop('window'); go(); return undefined; }\n", "              if (!lock) { go(); return undefined; }\n", 'a second window says why it takes no change'),
  ('a window that only shows the plan takes a change all the same', 'js/app.js',
   "    if (!ops.length) return false;\n    if (elsewhere()) return refuse(elsewhere());\n", "    if (!ops.length) return false;\n", 'every change a window took is in the stored plan'),
  ('nothing is saved as the page is hidden', 'js/store.js',
   "const hidden = () => { if (backend !== 'memory' && dirty && !saving) { clearTimeout(timer); flush(); } };", "const hidden = () => {};", 'within 0.2 s of the page being hidden'),
]
if mode == 'list': print(json.dumps({'node': len(NODE), 'page': len(PAGE)})); sys.exit(0)

def failed_lines(out):
    """The names of the lines a check failed, from its own report; None when it gave none."""
    i = out.rfind('{"passed"')
    if i >= 0:
        try: return [str(x) for x in json.loads(out[i:].split('\n')[0])['failed']]
        except Exception: return None
    if ' passed' not in out: return None
    return [l[5:].strip() for l in out.splitlines() if l.startswith('FAIL ')]   # the sync client's test prints its lines and a count
def copy():
    work = os.path.join(scratch, 'fault'); shutil.rmtree(work, ignore_errors=True)
    if mode == 'node':
        os.makedirs(os.path.join(work, 'js'))
        for name in ('store.js', 'sync.js'): shutil.copy(os.path.join(app, 'js', name), os.path.join(work, 'js', name))
        shutil.copytree(os.path.join(repo, 'worker'), os.path.join(work, 'worker')); shutil.copytree(os.path.join(repo, 'tools'), os.path.join(work, 'tools'), ignore=shutil.ignore_patterns('reader', '*.py'))
    else:
        shutil.copytree(app, work)
    return work
def run(work):
    """Every line that failed, and whether each check gave a report at all."""
    if mode == 'node':
        runs = [alone(['node', os.path.join(tests, 'store_test.cjs'), work], 120)[0], alone(['node', os.path.join(work, 'tools', 'sync_client_test.mjs'), os.path.join(work, 'js')], 120)[0]]
    else:
        runs = [alone([sys.executable, '-I', os.path.join(tests, 'two_windows_check.py'), work, os.path.join(scratch, 'fault-shots'), repo], 420)[0]]
    got = [failed_lines(out) for out in runs]
    return [name for names in got for name in (names or [])], all(names is not None for names in got)
STOPS = ('the test ran to its end', 'the check ran to its end')   # a check that only stops has named no line: that is not a catch

faults = [f for f in (NODE if mode == 'node' else PAGE) if not words or any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
caught, missed, broken, already = [], [], [], None
if faults:
    # What the checks do with no fault in them, which is looked at first: a line that fails then can catch nothing, and a check that gives no report can catch nothing at all.
    names, ran = run(copy())
    if not ran: print('with no fault in it a check gives no report: nothing can be shown to be caught', flush=True)
    else:
        already = set(names)
        if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
for n, (what, rel, now, fault, line) in enumerate(faults):
    work = copy(); path = os.path.join(work, rel); src = open(path, encoding='utf-8').read()
    if src.count(now) != 1:
        broken.append(what); print('BROKEN %d: %s -> the text to change is there %d times' % (n, what, src.count(now)), flush=True); continue
    open(path, 'w', encoding='utf-8').write(src.replace(now, fault))
    names, _ = run(work)
    hit = [x for x in names if line.lower() in x.lower() and already is not None and x not in already and not x.startswith(STOPS)]
    (caught if hit else missed).append(what)
    print(('caught ' if hit else 'MISSED ') + '%d: %s -> ' % (n, what) + (hit[0][:140] if hit else 'failed lines: %s' % names[:4]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(caught) + len(missed) + len(broken), 'caught': len(caught), 'missed': missed, 'broken': broken}, ensure_ascii=False))
