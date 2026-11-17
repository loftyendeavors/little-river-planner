"""Deliberate faults in the joining of two devices' plans as the page does it (S1c): the switch, the order of taking in, the plan's
line, a send whose answer was lost, undo after a taking-in, "Use mine". Each takes one rule or guard out of a copy of the code, and
a named line of a check must then fail where it passed before. (The join rules themselves are tests/mutate_merge.py.)

usage: python3 -I mutate_join.py <app-dir> <repo-dir> <scratch-dir> <tests-dir> [node | page | list] [words...]     env FROM=, TO= to run a part

node faults (seconds each) are put into js/sync.js or js/snapshots.js and run against tools/sync_client_test.mjs and
tests/snaps_test.cjs. page faults (a minute or two each) are put into a copy of the app folder and run against
tests/join_check.py in two real browsers. list: how many faults there are of each kind, and nothing else.
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

# (the rule or guard taken out, file, as it is, as the fault has it, words of the line that must fail)
NODE = [
  ('a device left on "Ask me" joins all the same', 'js/sync.js', "mode === 'plan' && cfg.join && await takeIn()", "mode === 'plan' && await takeIn()", 'on a device left on "Ask me"'),
  ('the switch is not acted on when it is turned on', 'js/sync.js', "return on && configured() ? run('join') : Promise.resolve(info());", "return Promise.resolve(info());", 'the plan that waited for the choice is joined at once'),
  ('the switch is not kept in the browser', 'js/sync.js', "keep({ join: on ? true : null }); st.joinNote = ''; emit();", "cfg.join = !!on; st.joinNote = ''; emit();", 'turned off again, it asks again'),
  ('a plan of another line is fetched and joined', 'js/sync.js', "      if (lineOf(st.cloud && st.cloud.meta) !== (cfg.line || null)) return no('A whole plan was put in the cloud on another device (a backup or a snapshot loaded, or one plan kept over another). Whole plans are not joined.');\n", "", 'starts a new line, and is never joined'),
  ('a whole plan sent starts no new line', 'js/sync.js', "line = whole ? newLine() : cfg.line || null;", "line = cfg.line || null;", 'starts a new line, and is never joined'),
  ('a plan opened from the cloud does not bring its line', 'js/sync.js', "line: typeof meta.line === 'string' ? meta.line : null, sent: null, ...photos.etags", "sent: null, ...photos.etags", 'takes its line'),
  ('changes are taken in while the page is busy', 'js/sync.js', "if (typeof host.idle === 'function' && !host.idle()) { set('joining'); schedule('join', timing.idle); return true; }", "", 'while something is being dragged'),
  ('a joined plan that could not be saved is asked about instead of stopping', 'js/sync.js', "if (got && got.stop) {", "if (false) {", 'cannot be saved here is not noted and not sent'),
  ('after a join the browser notes itself in step with a plan it does not hold', 'js/sync.js', "key: got.same ? got.key : 'joined:' + etag,", "key: got.key,", 'both changed: the two plans are joined'),
  ('what was taken in is not said', 'js/sync.js', "if (typeof host.taken === 'function') host.taken(", "if (false) host.taken(", 'what was taken in is said'),
  ('the cloud moved again while a joined plan was on its way: the page asks', 'js/sync.js', "if (cfg.join && cfg.base && !behind) { set('joining'); schedule('join', 200); } else set('conflict');", "set('conflict');", 'the join is set to be made again'),
  ('a send on its way is not noted', 'js/sync.js', "      keep({ sent: { savedAt: p.savedAt, key: p.key, bytes: p.text.length, line } });   // before the request: should its answer be lost, the next look knows this send again\n", "", 'known as this browser\'s own send'),
  ('a send whose answer was lost is taken for another device\'s plan', 'js/sync.js', "m.device === host.device() && m.savedAt === sent.savedAt && m.bytes === sent.bytes) {", "false) {", 'known as this browser\'s own send'),
  ('a device that joins does not say the planner\'s number', 'js/sync.js', "...(cfg.join || cloudKnows() ? { m: KNOWS } : {})", "...{}", 'the joined plan says it is one'),
  ('every page says the planner\'s number, joining or not', 'js/sync.js', "...(cfg.join || cloudKnows() ? { m: KNOWS } : {})", "m: KNOWS", 'where no device is set to join'),
  ('a page of this build that had not seen the number is told to reload', 'js/sync.js', "if (m <= KNOWS && m > cloudKnows()) { st.cloud = there; set('checking'); schedule('recheck', 50); return; }", "", 'is not told to reload'),
  ('a device that joins does not say the number until it has a change to send', 'js/sync.js', "else if (act === 'in-step' && mode === 'plan' && cfg.join && (cfg.v || 0) >= 3 && cloudKnows() < KNOWS) await push(cfg.base);", "else if (false) await push(cfg.base);", 'says the planner\'s number at once'),
  ('a plan that carries no planner\'s number is joined', 'js/sync.js', "      if (cloudKnows() < KNOWS) return no('The cloud’s plan was sent by an older planner, which does not say whether it is a whole plan loaded there. Reload the planner on the other device.');\n", "", 'carries no planner\'s number is never joined'),
  ('a whole plan loaded here during the fetch is joined', 'js/sync.js', "      if (host.loads() !== st.loads) return no('A whole plan was loaded here while the cloud’s was being fetched. Whole plans are not joined.');   // asked again after the waits\n", "", 'loaded here while the cloud\'s was being fetched'),
  ('a page no longer idle when the joined plan is ready: the page asks which plan to keep', 'js/sync.js', "        if (got && got.later) { set('joining'); schedule('join', timing.idle); return true; }", "", 'a window opened while the plans were being joined'),
  ('a busy page asks the cloud every moment', 'js/sync.js', "      if (reason === 'join' && st.status === 'joining' && cfg.join && typeof host.idle === 'function' && !host.idle()) { schedule('join', timing.idle); return Promise.resolve(info()); }", "", 'the cloud is not asked again'),
  ('a joined plan sent late is sent as an ordinary one', 'js/sync.js', "      joined = joined || String(cfg.key || '').startsWith('joined:');", "", 'sent as a joined plan when the connection is back'),
  ('the plans kept before a taking-in push the start-of-day snapshots out', 'js/snapshots.js', "all.filter(s => s.auto && !s.join).slice(KEEP_AUTO)", "all.filter(s => s.auto).slice(KEEP_AUTO)", 'kept apart from the 20'),
  ('of the plans kept before a taking-in only the newest five stay', 'js/snapshots.js', "if (s.at >= since && !hours.has(hour)) { hours.add(hour); keep.add(s.id); }", "", 'the first of each hour'),
  ('the plans kept before a taking-in are never thinned', 'js/snapshots.js', "...joins.filter(s => !keep.has(s.id))];", "];", 'the newest 5 stay'),
]
PAGE = [
  ('page: the switch turns on without a snapshot or a backup', 'js/backupui.js', "        const snap = await App.snapshot(`Before joining plans from two devices, ${UI.day(new Date())}`);\n        if (!snap) why = 'The snapshot could not be taken, so nothing was turned on.';\n        else if (!(await App.exportBackup())) why = 'The backup file was not saved, so nothing was turned on.';\n", "", 'a named snapshot is taken and a backup file downloaded first'),
  ('page: the switch turns on though the backup file was not saved', 'js/backupui.js', "        else if (!(await App.exportBackup())) why = 'The backup file was not saved, so nothing was turned on.';\n", "        else await App.exportBackup();\n", 'when the backup file cannot be saved'),
  ('page: the switch turns on without asking', 'js/backupui.js', "      if (!ok) return false;\n      switching = true; drawSync();", "      switching = true; drawSync();", 'Cancel leaves it off'),
  ('app: the plan that was here is not kept before changes are taken in', 'js/app.js', "      if (!before) return { ok: false, why: 'The plan here could not be kept first", "      if (false) return { ok: false, why: 'The plan here could not be kept first", 'cannot be kept first'),
  ('snapshots: a plan kept packed cannot be read back', 'js/snapshots.js', "    try { return new TextDecoder().decode(await viaStream(body.gz, new DecompressionStream('gzip'))); } catch (_) { return null; }", "    return null;", 'that snapshot reads back as the plan'),
  ('app: a plan sent again as it was is taken in like a change, with a snapshot of its own', 'js/app.js', "      if (r.same && !r.taken.any) return { ok: true, same: true, key: contentKey(plan), taken: r.taken, report: r.report, twice: 0 };\n", "", 'kept as a snapshot before anything is taken in'),
  ('app: a joined plan that is not saved leaves the joined records beside the old plan', 'js/app.js', "      catch (error) { store.save(state.plan); if (!(await putBack())) return lost; return { ok: false, stop: true,", "      catch (error) { store.save(state.plan); return { ok: false, stop: true,", 'the records kept beside the plan are as they were'),
  ('app: the records beside the plan are not taken in', 'js/app.js', "          await store.saveBlob('attic', text); await store.clearBlob('attic-new'); core = { ...core, lrfNext: { ...core.lrfNext, attic: 'cloud' } };\n", "", 'still there after the page is opened again'),
  ('app: records the join left empty are not taken as a change', 'js/app.js', "        newAttic = text !== JSON.stringify({ ...had, varieties: { ...(had.varieties || {}), ...extras.varieties } });", "        newAttic = text !== JSON.stringify({ ...had, varieties: { ...(had.varieties || {}), ...extras.varieties } }) && Object.keys(attic.rest || {}).length > 0;", 'the record the other device took out is gone here too'),
  ('app: taking in empties undo', 'js/app.js', "      state.redo.length = 0; state.last = null;\n      rebuild(); Thumbs.index(state.plan);", "      state.redo.length = 0; state.undo.length = 0; state.last = null;\n      rebuild(); Thumbs.index(state.plan);", 'undo and what was selected are kept'),
  ('app: changes are taken in with a window open', 'js/app.js', "&& !document.querySelector('dialog[open]') && Date.now() - lastTouch >= 1500;", "&& Date.now() - lastTouch >= 1500;", 'with a window open on the page nothing is taken in'),
  ('app: what was taken in is not said', 'js/app.js', "    if (line || rows.length || twice) toast(", "    if (false) toast(", 'says what was taken in'),
  ('app: undo puts a record back whole though another device has changed it', 'js/app.js', "    if (step.ops.every(op => alike(now(op), left(op)))) return { ops: step.ops, kept: 0 };", "    if (step.ops.length) return { ops: step.ops, kept: 0 };", 'takes out only what the step changed'),
  ('page: no strip when something was changed on both devices', 'js/backupui.js', "told = App.state.ready && !!j && j.rows.length > 0 && c.status !== 'conflict' && !c.offer,", "told = false,", 'a strip says something was changed on both devices'),
  ('app: "Use mine" leaves the other device\'s value', 'js/app.js', "    const done = commit('Used this device’s value', ops);", "    const done = true;", 'puts this device\'s value back'),
  ('app: this device\'s own notes about its plan are taken from the joined file', 'js/app.js', "        for (const key of Object.keys(mine)) if (!OWN_KEYS.includes(key)) note[key] = mine[key];   // what this device notes for itself stays its own\n", "", 'what this device notes for itself'),
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
        for name in ('store.js', 'sync.js', 'merge.js', 'snapshots.js'): shutil.copy(os.path.join(app, 'js', name), os.path.join(work, 'js', name))
        shutil.copytree(os.path.join(repo, 'worker'), os.path.join(work, 'worker')); shutil.copytree(os.path.join(repo, 'tools'), os.path.join(work, 'tools'), ignore=shutil.ignore_patterns('reader', '*.py'))
    else:
        shutil.copytree(app, work)
    return work
def run(work):
    """Every line that failed, and whether each check gave a report at all."""
    if mode == 'node':
        runs = [alone(['node', os.path.join(tests, 'snaps_test.cjs'), work], 120)[0], alone(['node', os.path.join(work, 'tools', 'sync_client_test.mjs'), os.path.join(work, 'js'), os.path.join(os.path.dirname(app), 'old', 'js')], 300)[0]]
    else:
        runs = [alone([sys.executable, '-I', os.path.join(tests, 'join_check.py'), work, os.path.join(scratch, 'fault-shots'), repo], 600)[0]]
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
