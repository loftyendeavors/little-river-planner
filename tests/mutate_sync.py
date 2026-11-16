"""Deliberate faults in cloud sync and snapshots: each must be caught by a line of a test
that passes with no fault in it: any such line counts, and a check that stops with no line failed catches nothing.

usage: python3 -I mutate_sync.py <app-dir> <repo-dir> <scratch-dir> <sync_check.py> [node | page | list] [words...]     env FROM=, TO= to run a part

node faults (seconds each) are put into the Worker or js/sync.js and run against tools/sync_worker_test.mjs and
tools/sync_client_test.mjs. page faults (minutes each) are put into the app's own files and run against sync_check.py,
which stops at the first failing line: one to ten minutes each. list: how many faults there are of each kind, and nothing else.
("page" ran the ten quickest and "page-all" every one; FROM and TO now pick a part, so "page" is every one.)
"""
import json, os, shutil, signal, subprocess, sys, time
app, repo, scratch, checker = sys.argv[1:5]
mode = sys.argv[5] if len(sys.argv) > 5 else 'node'; words = sys.argv[6:]
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
  ('worker: a write lands whatever the bucket holds', 'worker/lrf-plan-sync.js', "if ((base === 'none') !== !there || (there && there.etag !== base)) return json(412", "if (false) return json(412", 'worker'),
  ('worker: the write itself is not conditional', 'worker/lrf-plan-sync.js', "const put = await putIf(bucket, 'plan', bytes, there ? there.etag : null, {", "const put = await bucket.put('plan', bytes, {", 'worker'),
  ('worker: wrong passphrases are not counted', 'worker/lrf-plan-sync.js', "    next.n += 1;\n", "    next.n += 0;\n", 'worker'),
  ('worker: the count is rewritten without taking turns', 'worker/lrf-plan-sync.js', "const put = await putIf(bucket, GUARD.key, JSON.stringify(next), etag, {", "const put = await bucket.put(GUARD.key, JSON.stringify(next), {", 'worker'),
  ('worker: the passphrase is looked at before the turn is taken', 'worker/lrf-plan-sync.js', "        const turn = await claim(env.PLAN, now);\n        if (!turn.go) return", "        const turn = (await same(given, env.SYNC_KEY)) ? { go: true, left: 5 } : await claim(env.PLAN, now);\n        if (!turn.go) return", 'worker'),
  ('worker: locks do not grow', 'worker/lrf-plan-sync.js', "Math.min(GUARD.lock * 2 ** next.level, GUARD.longest)", "GUARD.lock", 'worker'),
  ('worker: a token is not checked against the passphrase', 'worker/lrf-plan-sync.js', "return (await same(m[3], await sign(env, `v1.${m[2]}`))) ? +m[2] - now : 0;", "return +m[2] - now;", 'worker'),
  ('worker: a token never ends', 'worker/lrf-plan-sync.js', "if (!m || +m[2] <= now) return 0;", "if (!m) return 0;", 'worker'),
  ('worker: any website is answered', 'worker/lrf-plan-sync.js', "const allowedOrigin = origin => PLANNERS.includes(origin) || isLocal(origin);", "const allowedOrigin = origin => true;", 'worker'),
  ('worker: no daily copy is kept', 'worker/lrf-plan-sync.js', "if (wasDay && wasDay !== dayOf(meta.savedAt) && !(await bucket.head(`day/${wasDay}`)))", "if (false)", 'worker'),
  ('worker: a replaced plan is not kept', 'worker/lrf-plan-sync.js', "    if (replace) { await copy(", "    if (false) { await copy(", 'worker'),
  ('worker: daily copies are never thinned', 'worker/lrf-plan-sync.js', "await prune(bucket, await listAll(bucket, 'day/'), LIMITS.days);", "", 'worker'),
  ('worker: the count can be read from outside', 'worker/lrf-plan-sync.js', "  m = /^\\/(snap|day)\\/([A-Za-z0-9-]{4,64})$/.exec(path);\n  if (m) {\n    const key = `${m[1]}/${m[2]}`;", "  m = /^\\/(snap|day|guard)\\/?([A-Za-z0-9-]{0,64})$/.exec(path);\n  if (m) {\n    const key = m[1] === 'guard' ? 'guard' : `${m[1]}/${m[2]}`;", 'worker'),
  ('client: both changed, and it sends anyway', 'js/sync.js', "return dirty ? 'conflict' : 'newer';", "return dirty ? 'push' : 'newer';", 'client'),
  ('client: told the cloud has moved, it writes over it', 'js/sync.js', "        st.first = !cfg.base; set('conflict'); return;", "        keep({ base: st.cloud.etag }); schedule('change', 10); set('in-step'); return;", 'client'),
  ('client: a newer plan is swapped in while the page is in use', 'js/sync.js', "if (reason === 'start' || reason === 'connect') { if (await pull())", "if (true) { if (await pull())", 'client'),
  ('client: the sample plan is sent', 'js/sync.js', "if (!cloud) return sample ? 'nothing' : 'push-first';", "if (!cloud) return 'push-first';", 'client'),
  ('client: a plan in each, never synced: it sends', 'js/sync.js', "if (!base) return 'ask-first';", "if (!base) return 'push';", 'client'),
  ('client: the passphrase is kept in the browser', 'js/sync.js', "keep({ url: at, token: got.token, label:", "keep({ url: at, token: got.token, pass: String(passphrase), label:", 'client'),
  ('client: with no connection it says all is well', 'js/sync.js', "st.tries += 1; set('waiting', error.message);", "st.tries += 1; set('in-step');", 'client'),
  ('client: a stored plan that will not open is synced anyway', 'js/sync.js', "          if (mode === 'held') { set('held'); return; }\n", "", 'client'),
  ('client: after opening the cloud\'s plan it does not note what it holds', 'js/sync.js', "keep({ base: etag, key: host.key(), savedAt: meta.savedAt || null, ...photos.etags, extrasKey: await host.extrasKey() });", "keep({ base: etag, savedAt: meta.savedAt || null, ...photos.etags, extrasKey: await host.extrasKey() });", 'client'),
  ('client: a whole plan loaded over the open one is sent like any change', 'js/sync.js', "...(replace || host.loads() !== st.loads ? { 'x-lrf-replace': '1' } : {})", "...(replace ? { 'x-lrf-replace': '1' } : {})", 'client'),
  ('client: "keep this plan" does not ask the cloud to keep the other', 'js/sync.js', "return solo(() => push(st.cloud.etag, true));", "return solo(() => push(st.cloud.etag, false));", 'client'),
  ('client: photos are sent every time', 'js/sync.js', "      if (mine === cfg.extrasKey) {\n", "      if (false) {\n", 'client'),
  ('client: photos added on another device are not fetched', 'js/sync.js', "? photosDown(remote) : false;", "? false : false;", 'client'),
  # the service's version 3, and the plan kept to compare with
  ('worker: an older planner writes over a newer one\'s plan', 'worker/lrf-plan-sync.js', "if (there && (metaOf(there).m || 0) > (meta.m || 0)) return json(409,", "if (false) return json(409,", 'worker'),
  ('worker: an older planner is refused with "sign in again"', 'worker/lrf-plan-sync.js', "return json(409, { error: 'This device is running an older planner. Reload the page.'", "return json(401, { error: 'This device is running an older planner. Reload the page.'", 'worker'),
  ('worker: a planner\'s number is not kept with the plan', 'worker/lrf-plan-sync.js', "  if (Number.isInteger(meta.m) && meta.m > 0 && meta.m < 1000) out.m = meta.m;", "  if (false) out.m = meta.m;", 'worker'),
  ('worker: a plan\'s line is not kept with it', 'worker/lrf-plan-sync.js', "'name', 'enc', 'why', 'line']", "'name', 'enc', 'why']", 'worker'),
  ('worker: the plan before a join is not kept', 'worker/lrf-plan-sync.js', "    if (meta.merged && !replace) {   // `merged` is true or absent: readMeta keeps nothing else\n", "    if (false) {\n", 'worker'),
  ('worker: the plans before a join are never thinned', 'worker/lrf-plan-sync.js', "  if (before) { try { await pruneMerges(bucket, now); } catch (_) {", "  if (before) { try { } catch (_) {", 'worker'),
  ('worker: a joined plan that did not land leaves its "plan before" behind', 'worker/lrf-plan-sync.js', "if (!put) { if (before) await bucket.delete(before); return json(412,", "if (!put) { return json(412,", 'worker'),
  ('worker: of the plans before a join only the last ten are kept, not the first of each hour', 'worker/lrf-plan-sync.js', "if (key >= since && !hours.has(hour)) {", "if (false) {", 'worker'),
  ('worker: a plan replaced on purpose by a joined plan is kept twice', 'worker/lrf-plan-sync.js', "    if (meta.merged && !replace) {", "    if (meta.merged) {", 'worker'),
  ('worker: any word under "merged" counts as a joined plan', 'worker/lrf-plan-sync.js', "  if (meta.merged === true) out.merged = true;", "  if (meta.merged) out.merged = true;", 'worker'),
  ('worker: a planner\'s number has no ceiling', 'worker/lrf-plan-sync.js', "meta.m > 0 && meta.m < 1000) out.m = meta.m;", "meta.m > 0) out.m = meta.m;", 'worker'),
  ('worker: a page can write a "plan before a join" of its own', 'worker/lrf-plan-sync.js', " && !m[2].startsWith('merge-')) {", ") {", 'worker'),
  ('client: the plan sent is not kept to compare with', 'js/sync.js', "      await keepPlan(done.plan.etag, p.text, p.key);   // what the cloud now holds is this very text. Last: nothing above waits for the database\n", "", 'client'),
  ('client: the plan opened from the cloud is not kept to compare with', 'js/sync.js', "      await keepPlan(etag, text, host.key());\n", "", 'client'),
  ('client: a browser in step with no plan kept never fetches one', 'js/sync.js', "await ensureKept().catch(", "await Promise.resolve(false).catch(", 'client'),
  ('client: with a database that refuses, the cloud\'s plan is fetched at every look', 'js/sync.js', "if (st.kept === cfg.base || st.keptTried === cfg.base) return", "if (st.kept === cfg.base) return", 'client'),
  ('client: a plan kept under another stamp is handed out as the plan to compare with', 'js/sync.js', "return k && k.etag === cfg.base ? k : null;", "return k || null;", 'client'),
  ('client: a kept plan that cannot be written fails the send', 'js/sync.js', "        st.kept = null; st.keptNote = (error && error.message) || 'The plan to compare with could not be kept.';", "        throw error;", 'client'),
  ('client: the page says a plan is kept when none is', 'js/sync.js', "kept: !!cfg.base && st.kept === cfg.base, keptNote", "kept: !!cfg.base, keptNote", 'client'),
  ('client: leaving the cloud leaves the kept plan behind', 'js/sync.js', "if (kept && !st.keptOff && !quiet()) Promise.resolve().then(() => kept.clear()).catch(() => {});", "", 'client'),
  ('client: a window that only shows the plan empties the kept plan', 'js/sync.js', "if (kept && !st.keptOff && !quiet()) Promise.resolve()", "if (kept && !st.keptOff) Promise.resolve()", 'client'),
  ('client: the kept plan is handed out after a whole plan was loaded over the open one', 'js/sync.js', "if (!kept || st.keptOff || !cfg.base || behind || host.loads() !== st.loads) return null;", "if (!kept || st.keptOff || !cfg.base || behind) return null;", 'client'),
  ('client: the kept plan is handed out for a stored plan that is behind', 'js/sync.js', "if (!kept || st.keptOff || !cfg.base || behind || host.loads() !== st.loads) return null;", "if (!kept || st.keptOff || !cfg.base || host.loads() !== st.loads) return null;", 'client'),
  ('client: a fetch of the plan to keep that fails is not tried again', 'js/sync.js', "      const res = await call('GET', '/plan', { raw: true }), meta = readMeta(res), etag = res.headers.get('x-lrf-etag');   // a fetch that fails is tried again at the next look\n", "      st.keptTried = cfg.base;\n      const res = await call('GET', '/plan', { raw: true }), meta = readMeta(res), etag = res.headers.get('x-lrf-etag');\n", 'client'),
  ('client: a plan fetched after the cloud moved is kept all the same', 'js/sync.js', "      if (etag !== cfg.base) return false;   // the cloud moved between the look and the fetch: the next look says so\n", "", 'client'),
  ('client: a plan the database refused is fetched again at the next look', 'js/sync.js', "        st.keptTried = etag;   // refused for this very plan: the look that follows does not fetch it to be refused again\n", "", 'client'),
  ('client: the kept plan is asked of a database that did not answer', 'js/sync.js', "if (!kept || st.keptOff || !cfg.base || behind", "if (!kept || !cfg.base || behind", 'client'),
  ('client: a plan loaded while the sent plan is being kept is not marked as loaded', 'js/sync.js', "st.snoozed = null; st.loads = loads;\n      await keepPlan(done.plan.etag, p.text, p.key);", "st.snoozed = null;\n      await keepPlan(done.plan.etag, p.text, p.key); st.loads = host.loads();", 'client'),
  ('worker: a thinning that fails turns a stored plan into an error', 'worker/lrf-plan-sync.js', "  if (before) { try { await pruneMerges(bucket, now); } catch (_) {", "  if (before) { await pruneMerges(bucket, now); try { } catch (_) {", 'worker'),
  ('client: a page opened again does not read what it has kept', 'js/sync.js', "st.kept = n ? n.etag : null; }", "st.kept = null; }", 'client'),
  ('client: a database that never answers leaves the send waiting', 'js/sync.js', "try { await answered(kept.put({ etag, text, key, at: new Date().toISOString() }));", "try { await kept.put({ etag, text, key, at: new Date().toISOString() });", 'client'),
  ('client: a database that did not answer is asked again at every send', 'js/sync.js', "t = later(() => { st.keptOff = true; reject(", "t = later(() => { reject(", 'client'),
  ('client: the plan is kept before the stamp it is kept under is noted', 'js/sync.js', "      keep({ base: done.plan.etag, key: p.key, savedAt: p.savedAt });\n", "      await keepPlan(done.plan.etag, p.text, p.key); keep({ base: done.plan.etag, key: p.key, savedAt: p.savedAt });\n", 'client'),
]
PAGE = [
  ('app: a change is not handed to sync', 'js/app.js', "    folderSoon();\n    if (sync) sync.touch();\n    emit('plan');\n  }", "    folderSoon();\n    emit('plan');\n  }"),
  ('app: the indicator says nothing of the cloud', 'js/app.js', "else if (c.status === 'in-step' && info.state === 'saved' && c.savedAt) { text = filed ?", "else if (false) { text = filed ?"),
  ('app: the plan\'s fingerprint counts its bookkeeping', 'js/app.js', "    const text = JSON.stringify({ ...plan, lrfNext: keep });", "    const text = JSON.stringify(plan);"),
  ('page: the newer-plan strip is not shown', 'js/backupui.js', "show = App.state.ready && (c.status === 'conflict' || !!c.offer);", "show = App.state.ready && c.status === 'conflict';"),
  ('app: the plan replaced by the cloud\'s is not kept', 'js/app.js', "    if (replacing) state.lastAuto = await snapshot(extra.why || `Before loading ${file.name}`, { auto: true, skipSame: true });", "    if (replacing && !extra.exact) state.lastAuto = await snapshot(extra.why || `Before loading ${file.name}`, { auto: true, skipSame: true });"),
  ('page: "keep this plan" does not ask', 'js/backupui.js', "confirmLabel: 'Save over the cloud’s', danger: true });\n    if (!ok) return false;", "confirmLabel: 'Save over the cloud’s', danger: true });"),
  ('page: "open the cloud\'s plan" over changed work does not ask', 'js/backupui.js', "    if (dirty) {\n      const m = (c.cloud && c.cloud.meta) || {};", "    if (false) {\n      const m = (c.cloud && c.cloud.meta) || {};"),
  ('app: with no connection the indicator shows alarm', 'js/app.js', "else if (c.status === 'waiting' && info.state === 'saved') { text = filed ?", "else if (c.status === 'waiting' && info.state === 'saved') { state2 = 'error'; text = filed ?"),
  ('app: no snapshot at the first change of a day', 'js/app.js', "    startOfDay();   // the plan as it stood before the first change of a day is kept as a snapshot\n", ""),
  ('app: a "start of day" snapshot at every opening of the page', 'js/app.js', "today = options.daily ? kept.find(s => s.why === 'day:' + options.daily) : null;", "today = null;"),
  ('app: a named snapshot is not copied to the cloud', 'js/app.js', "      if (!record.auto) sendSnapshot(record, made.text);", ""),
  ('app: going back to a snapshot does not ask', 'js/app.js', "    if (!options.asked) {\n      const at = new Date(row.at), ok =", "    if (false) {\n      const at = new Date(row.at), ok ="),
  ('app: going back cannot be taken back', 'js/app.js', "    const before = state.lastAuto;   // the plan as it was a moment ago, kept by importBackup", "    const before = null;"),
  ('app: deleting a snapshot leaves the cloud\'s copy', 'js/app.js', "      if (row.cloud && sync && sync.info().configured) await sync.dropSnap(row.kind, row.id);", ""),
  ('app: automatic snapshots are never thinned', 'js/snapshots.js', "    if (record.auto) await prune();", ""),
  ('kept: the plan is kept under a stamp of its own making, not the cloud\'s', 'js/kept.js', "const note = { etag: record.etag, key:", "const note = { etag: 'x' + record.etag, key:"),
  ('kept: the text is not written with its stamp', 'js/kept.js', "store.put(record.text, 'text'); return store.put(note, 'note');", "return store.put(note, 'note');"),
  ('app: a stored plan that will not open: sync is not even started', 'js/app.js', "      startSync();   // nothing is sent or opened by itself in this state; the cloud's plan can be asked for\n", ""),
]

def run(cmd, timeout, env=None):
    out, err = alone(cmd, timeout, env=env)
    return out.replace('\ntimed out', '') + '\n' + err + ('\nTIMEOUT' if out.endswith('\ntimed out') else '')
def fails(out):
    seen = [l[5:].strip()[:110] for l in out.splitlines() if l.startswith('FAIL ')]
    return seen or (['THE TEST STOPPED WITHOUT A REPORT'] if ' passed' not in out and '"passed"' not in out else [])

if mode == 'list': print(json.dumps({'node': len(NODE), 'page': len(PAGE)})); sys.exit(0)
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
faults = [f for f in (NODE if mode == 'node' else PAGE) if not words or any(w in f[0] for w in words)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
out = []
STOPS = ('the test ran to its end', 'the check ran to its end', 'THE TEST STOPPED')   # a test that only stops has named no line: that is not a catch
for fault in ([(None, None, None, None)] if faults else []) + faults:
    name, rel, a, b = fault[:4]
    if mode == 'node':
        work = os.path.join(scratch, 'mut-node'); shutil.rmtree(work, ignore_errors=True)
        os.makedirs(os.path.join(work, 'js')); shutil.copytree(os.path.join(repo, 'worker'), os.path.join(work, 'worker')); shutil.copytree(os.path.join(repo, 'tools'), os.path.join(work, 'tools'), ignore=shutil.ignore_patterns('reader', '*.py'))
        for script in ('sync.js', 'merge.js'): shutil.copy(os.path.join(app, 'js', script), os.path.join(work, 'js', script))
    else:
        work = os.path.join(scratch, 'mut-page'); shutil.rmtree(work, ignore_errors=True); shutil.copytree(app, work)
    if name is not None:
        path = os.path.join(work, rel); src = open(path, encoding='utf-8').read()
        if src.count(a) != 1:
            out.append({'fault': name, 'broken': True, 'caught': False, 'by': 'THE FAULT DID NOT APPLY (%d places)' % src.count(a)}); print('BROKEN ' + json.dumps(out[-1]), flush=True); continue
        open(path, 'w', encoding='utf-8').write(src.replace(a, b))
    if mode == 'node':
        seen = fails(run(['node', os.path.join(work, 'tools', 'sync_worker_test.mjs')], 120)) + fails(run(['node', os.path.join(work, 'tools', 'sync_client_test.mjs'), os.path.join(work, 'js'), os.path.join(os.path.dirname(app), 'old', 'js')], 120))   # with the build before's client beside it, as the run of every push has it
        if name is None and seen:   # these two print a failing line with its figures after its name, so the lines of two runs cannot be matched by name
            print('with no fault in it the tests already fail: nothing can be shown to be caught: ' + '; '.join(seen)[:500], flush=True); already = None; continue
    else:
        got = run([sys.executable, '-I', checker, work, os.path.join(scratch, 'mut-shots'), repo], 900, env={**os.environ, 'STOP_AT_FAIL': '1'})
        try: seen = [str(x) for x in json.loads(got[got.rindex('{"passed"'):].split('\n')[0])['failed']]   # the names of the lines that failed, as the check's last line gives them
        except Exception: seen = ['THE TEST STOPPED WITHOUT A REPORT']
    named = [x for x in seen if not x.startswith(STOPS)]
    if name is None: already = unfaulted(named, bool(named) or not seen); continue
    named = [x for x in named if already is not None and x not in already]
    out.append({'fault': name, 'caught': bool(named), 'by': (named or [x + ' (which fails with no fault in it too)' if not x.startswith(STOPS) else x for x in seen])[:2]}); print(('caught ' if named else 'MISSED ') + json.dumps(out[-1]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(out), 'caught': sum(1 for o in out if o['caught']), 'missed': [o['fault'] for o in out if not o['caught'] and not o.get('broken')], 'broken': [o['fault'] for o in out if o.get('broken')]}))
