"""Deliberate faults in the joining of two copies of a plan (js/merge.js): each takes one rule or one guard out of a copy of the
code, and a named line of tests/merge_test.cjs must then fail where it passed before.

usage: python3 -I mutate_merge.py <app-dir> <scratch-dir> <tests-dir> <plan.json> <inventory.json> [node | list] [words...]     env FROM=, TO= to run a part

A fault is a few seconds: the check is run with 40 pairs of runs of edits, not 500.
"""
import json, os, shutil, subprocess, sys
app, scratch, tests, plan, stock = sys.argv[1:6]
mode = sys.argv[6] if len(sys.argv) > 6 else 'node'; words = [w.lower() for w in sys.argv[7:]]

# (the rule or guard taken out, as it is, as the fault has it, words of the line that must fail)
NODE = [
  # by shape
  ('the same box changed on both sides: this device\'s value stands', "    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });\n    return t;\n  }\n  function joinObject", "    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });\n    return m;\n  }\n  function joinObject", 'the same box changed to different values'),
  ('the same box changed on both sides is not reported', "    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });\n    return t;\n  }\n  function joinObject", "    return t;\n  }\n  function joinObject", 'the same box changed to different values'),
  ('taken out here and changed there: it goes', "      else if (!same(S.get(rec.id), rec)) { out.push(rec); said(ctx, { kind: 'kept', path: here, id: rec.id, removedBy: 'mine' }); }", "", 'taken out on one side, changed on the other'),
  ('taken out there and changed here: it goes', "      else if (!same(S.get(rec.id), rec)) { out.push(rec); said(ctx, { kind: 'kept', path: here, id: rec.id, removedBy: 'theirs' }); }", "", 'taken out on one side, changed on the other'),
  ('a record this device added is dropped', "      if (!S.has(rec.id)) out.push(rec);                                         // this device added it\n      else if", "      if (!S.has(rec.id)) { /* dropped */ }\n      else if", 'a record added on each side'),
  ('a record the cloud added is dropped', "      else if (!S.has(rec.id)) out.push(rec);                                    // the cloud added it", "      else if (!S.has(rec.id)) { /* dropped */ }", 'a record added on each side'),
  ('a bed\'s place on the map is joined half from each side', "const WHOLE = new Set(['beds[].px', ", "const WHOLE = new Set([", 'a thing taken whole'),
  ('of two stamps the earlier is kept', "return m > t ? m : t;", "return m > t ? t : m;", 'a stamp: the later one'),
  ('who saved a file is reported as a box changed on both sides', "const QUIET = new Set(['lrfNextKeep.device', 'lrfNextKeep.v']);", "const QUIET = new Set([]);", 'a plan as a file holds it'),
  ('a key named __proto__ is lost', "if (key === '__proto__') Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true }); else out[key] = value;", "out[key] = value;", 'a key of any name'),
  # a planting, its place and its day
  ('a planting\'s place is joined box by box', "const PLACE = ['bedId', 'ft', 'startFt', 'bedLayout', 'seat'], TIME", "const PLACE = [], TIME", 'a planting\'s place is one value'),
  ('a sowing day set by hand is joined apart from the planting\'s day', "TIME = ['date', 'sowOn'];", "TIME = ['date'];", 'a sowing day set by hand'),
  ('a planting whose record of work cannot be read is joined as if it could', "    if (![s0, m, t].every(readable)) return joinObject(ctx, pat, path, s0, m, t);\n", "", 'cannot be read is joined by shape'),
  # a recording is one unit
  ('one sowing ticked on both: this device\'s seed stays on the planting', "...um.filter(u => whose(u) === 'm'),", "...um.filter(u => !free(u) && !ut.some(x => same(x, u))),", 'one sowing ticked on both devices draws seed once'),
  ('this device\'s lines of a job are added after the cloud\'s whoever\'s story stands', "if (!loose(x) && side.get(kindOf(x)) === 'm' && take(mineHas, x)) history.push(x);", "if (!loose(x) && !ht.some(y => same(y, x))) history.push(x);", 'recorded and taken back here, recorded there'),
  ('one sowing ticked on both: this device\'s stands over the cloud\'s', "      else if (!(carriesOn(ks, km) && begins(km, kt)) && !sameJob(jm, js)) said(", "      else if (!(carriesOn(ks, km) && begins(km, kt)) && !sameJob(jm, js)) who = 'm';\n      else if (false) said(", 'one sowing ticked on both devices draws seed once'),
  ('a sowing recorded on both is not reported', "      else if (!(carriesOn(ks, km) && begins(km, kt)) && !sameJob(jm, js)) said(ctx, { kind: 'recorded-twice', path, id, job: kind, mine: jm ? jm.date : null, theirs: jt ? jt.date : null });\n", "", 'one sowing ticked on both devices draws seed once'),
  ('a sowing the cloud holds from this device, taken back here: the cloud\'s copy stands', "else if (theirsSame || (carriesOn(ks, kt) && begins(kt, km))) who = 'm';", "else if (theirsSame) who = 'm';", 'a send whose answer was lost, and that sowing then taken back here'),
  ('two jobs in an order the planner refuses both stand', "      if (day(first) == null || day(second) == null || day(first) <= day(second)) continue;\n", "      if (day(first) !== undefined) continue;\n", 'in an order the planner refuses'),
  ('a side whose story of a job stands is held to have the day only when it recorded the job', "      if (who === 'm' && mineMoved) mineStands = true;", "      if (who === 'm' && mineMoved && jm) mineStands = true;", 'the day it had pushed goes back'),
  ('a recording both sides hold gives the cloud the planting\'s place', "      side.set(kind, who); jobs.set(kind, { js, jm, jt, alike, mineMoved: !mineSame && !alike, theirsMoved: !theirsSame && !alike });", "      side.set(kind, who); jobs.set(kind, { js, jm, jt, alike, mineMoved: !mineSame && !alike, theirsMoved: !theirsSame });", 'then the planting moved here'),
  ('a day pushed by a recording both sides hold is measured from the start', "    const shared = pushedTo ? { ...s0, date: pushedTo, sowOn: undefined } : s0;", "    const shared = s0;", 'the day set here stands, though the sowing had pushed it'),
  ('the base for the day is the first shared push, not the last', "    for (const x of ht) if (sharedLines.some(line => same(line, x)) && isObj(x.follow) && x.follow.to && !same(x.follow.from, x.follow.to)) pushedTo = x.follow.to;", "    for (const x of ht) if (!pushedTo && sharedLines.some(line => same(line, x)) && isObj(x.follow) && x.follow.to && !same(x.follow.from, x.follow.to)) pushedTo = x.follow.to;", 'the day after the last of them is the base'),
  ('a push the start already holds is taken as the base for the day', " && !hs.some(x => same(x, j.jt.line))).map(j => j.jt.line);", ").map(j => j.jt.line);", 'long before, the planting since moved'),
  ('the order of jobs is checked once', "    for (let moved = true; moved;) { moved = false; for (const [first, second] of ctx.order) {", "    for (let moved = true, once = true; once; once = false) { moved = false; for (const [first, second] of ctx.order) {", 'given back to the cloud'),
  ('the joined log keeps both sides\' lines of a sowing', "      if (!keep) ctx.report.dropped.push(e.id);", "      if (!keep) ctx.report.dropped.push(e.id); return true;", 'can be joined again, as this device'),
  ('an overdraw is written into the log as a hand count', "          const lines = [...beyond].map(([batch, amount]) => line(batch, amount, `Joined: sowing ${batch} drew ${amount} beyond the lot`));", "          const lines = [...beyond].map(([batch, amount]) => line(batch, amount, `Joined from two devices: ${amount}`));", 'a lot ran short can be joined again'),
  ('an overdraw is not written into the log', "          log = [...log, ...lines];", "          log = [...log];", 'a lot ran short can be joined again'),
  ('a sowing on a planting taken out and kept by the other side is not said', "    for (const u of unlinked) if (kept.some(k => k.removedBy === u.whose)) said(", "    for (const u of unlinked) if (false) said(", 'still drew seed'),
  ('a kept planting\'s sowing goes by the log alone, not by its seed lines', "      else if (placed.has(home.get(batch))) {", "      else if (false) {", 'the planting kept with the cloud'),
  ('test 5 does not check the joined log', "return `A seed lot's count does not follow the joined record of changes (${lot.id}).`; }", "void 0; }", 'a line in the joined log that no lot follows'),
  ('a move made on the other device is applied over recorded work', "const recorder = theirsRecorded && !mineStands ? 't' : mineStands && !theirsRecorded ? 'm' : '';", "const recorder = '';", 'the recorded bed and day stand'),
  ('two different jobs, one on each device: the cloud\'s day stands though only this device changed it', "const recorder = theirsRecorded && !mineStands ? 't' : mineStands && !theirsRecorded ? 'm' : '';", "const recorder = theirsRecorded ? 't' : mineStands ? 'm' : '';", 'the pushed day is kept whichever device'),
  ('two different jobs and two days: this device\'s day is dropped without a word', "      else if (theirsRecorded) said(ctx, { kind: 'move-not-applied', path, id, what, whose: 'mine', mine: shown(m), theirs: shown(t) });\n", "      else if (theirsRecorded) { /* nothing said */ }\n", 'each device also changed the day'),
  ('a sowing taken back here: its seed lines stay on a planting the cloud also changed', "const seedUse = [...ut.filter(u => (free(u) ? !take(goneUse, u) : whose(u) === 't')),", "const seedUse = [...ut,", 'on a planting the other device also changed'),
  # seed on hand
  ('seed: a change the cloud already holds is counted again', "if (!theirs.has(e.id) && !first.has(e.id)) add(e, 1);", "if (!first.has(e.id)) add(e, 1);", 'the same count of a lot seen twice'),
  ('seed: a count undone here stays', "    for (const e of listOf(start, 'adjustments')) if (theirs.has(e.id) && !mine.has(e.id)) add(e, -1);\n", "", 'a count undone here'),
  ('seed: a sowing\'s draw is counted as a hand count too', "(!all && batchIn(e) != null)", "(false)", 'a sowing ticked here while the cloud'),
  ('seed: a sowing taken back is counted as a hand count too', "e.kind === 'count' ? /^Sowing (\\S+) taken back: /.exec(reason) || /^Joined: sowing (\\S+) drew /.exec(reason) : null;", "e.kind === 'count' ? /^Joined: sowing (\\S+) drew /.exec(reason) : null;", 'its seed is back on the lot, once'),
  ('seed: counted by hand on both sides, both are applied', "      if (own && theirsOnly.get(lot.id)) { own = 0; clash = true; }   // counted by hand on both sides: the cloud's count stands\n", "", 'a lot counted by hand on both devices'),
  ('seed: what this device\'s sowings took is not taken off the lot', " + ((lt ? fromTheirs : fromMine).get(String(lot.id)) || 0)), clash,", "), clash,", 'two sowings of one variety'),
  ('seed: a lot only this device holds has its changes counted twice', "let own = lt && lm ? mineOnly.get(lot.id) || 0 : 0, clash = false;", "let own = mineOnly.get(lot.id) || 0, clash = false;", 'a lot added on each device'),
  ('seed: a sown planting taken out of the plan gives its seed back', "const byLog = (s, m, t) => (near(m, s) ? t : near(t, s) ? m : t);", "const byLog = (s, m, t) => 0;", 'a sown planting taken out of the plan'),
  ('seed: a lot goes below zero', "      if (q < -1e-6) {\n", "      if (false) {\n", 'more drawn on two devices than a lot holds'),
  ('seed: an overdraw is not reported', "        said(ctx, { kind: 'seed-short', path: ['seedInventory', 'lots', '#' + lot.id], id: lot.id, short: whole, loose: round6(whole - short) });\n", "", 'more drawn on two devices than a lot holds'),
  ('seed: this device\'s log is not held to its counts', "throw new Error('The seed on hand here does not follow its own record of changes.');", "void 0;", 'its own log does not account for'),
  # what waits
  ('a planting is left both on its bed and waiting', "const twice = isObj(w) && placed.has(w.id) && !(before.has(w.id) && stillTheirs.has(w.id));", "const twice = false;", 'a planting put on a bed on one side'),
  ('in a file, a planting is left both on its bed and waiting', "    if (isObj(plan.lrfNextKeep) && isObj(plan.lrfNextKeep.keep)) out.lrfNextKeep = ", "    if (false) out.lrfNextKeep = ", 'and in a file too'),
  ('placed on one device and taken off the waiting list on the other: nothing is said', "said(ctx, { kind: 'kept', path: ['plantings', '#' + p.id], id: p.id, removedBy });", "void 0;", 'waiting at the start, put on a bed'),
  # the five tests, and what a plan must be
  ('a plan with a planting that has no id is joined', "        if (not) throw new Error(`The plan ${name} ${not}.`);\n", "", 'not all records with ids'),
  ('test 1 is not made: a plan that does not read back is used', "    if (!same(JSON.parse(text), plan)) return 'The joined plan does not read back as it was written.';\n", "", '1. a joined plan that does not open'),
  ('test 1 is not made: plantings that are not records', "    if (not) return `The joined plan ${not}.`;\n", "", '1. so does one whose plantings'),
  ('test 2 is not made: an id twice', "const twice = repeats(list); if (twice != null && !why", "const twice = null; if (twice != null && !why", '2. an id there twice'),
  ('test 2 refuses a list that already had an id twice', " && !(a && repeats(a) != null) && !(b && repeats(b) != null)) why =", ") why =", 'already had an id twice is one value'),
  ('test 3 is not made: a changed record missing', "for (const rec of list) if ((!was.has(rec.id) || !same(was.get(rec.id), rec)) && !(now && now.has(rec.id))", "for (const rec of list) if (false && !(now && now.has(rec.id))", '3. a record one side changed'),
  ('test 3 refuses records that went with a thing taken whole', " && !under(path)) { why =", ") { why =", 'inside a thing taken whole'),
  ('test 4 is not made: a recorded day missing', "        if (!joined || !same(doneOf(joined)[kind], date)) return", "        if (false) return", '4. a day of recorded work'),
  ('test 4 is not made for this device\'s side', "        if (name === 'mine' && twice.has(`${id}|${kind}`)) continue;", "        if (name === 'mine') continue;", '4. and so does one this device recorded'),
  ('test 4 refuses a sowing the other device saw and took back', "        if (seen && !same(doneOf(other.get(id))[kind], date)) continue;\n", "", 'a send whose answer was lost, and that sowing then taken back here'),
  ('test 5 is not made: seed that does not add up', "        if (!near(num(lot.quantity), Math.max(0, to.q))) return", "        if (false) return", '5. seed that does not add up'),
  ('test 5 is not made: two sowings\' seed on one planting', "        if (n(p) > Math.max(1, n(M.get(p.id)), n(T.get(p.id)))) return", "        if (false) return", '5. a planting that draws seed for two sowings'),
  ('test 5 is not made: a lot below zero', "        if (num(lot.quantity) < 0) return", "        if (false) return", '5. a lot below zero'),
  ('test 5 is not made: an overdraw nobody reported', "        if (to.q < -1e-6 && !items.some(", "        if (false && !items.some(", '5. a lot drawn below zero that the report does not name'),
  ('test 5 works the lots the same way they were set, not from the seed lines', "(P.has(home.get(batch)) ? -(lines.get(batch + '\\u0000' + lotId) || 0) : byLog(s, m, t))", "byLog(s, m, t)", '5. seed lines left on a planting'),
  ('a joined plan that fails a test is handed back all the same', "      return why ? { ok: false, why, report } : { ok: true, plan, report };", "      return { ok: true, plan, report };", 'fails one of the five tests is not handed back'),
  ('a list without ids goes unseen', "        if (objects.length && !idsOf(node)) {", "        if (false) {", 'a list added without ids'),
  ('a side that changed nothing: the plan is built again all the same', "      if (plan === mine || plan === theirs) return { ok: true, plan, report };   // one side changed nothing: the other's plan, as it is\n", "      if (plan === mine || plan === theirs) return { ok: true, plan: JSON.parse(JSON.stringify(plan)), report };\n", 'a side that changed nothing changes nothing: the other side'),
]
if mode == 'list': print(json.dumps({'node': len(NODE)})); sys.exit(0)

def failed_lines(out):
    i = out.rfind('{"passed"')
    if i < 0: return None
    try: return [str(x) for x in json.loads(out[i:].split('\n')[0])['failed']]
    except Exception: return None
def copy():
    work = os.path.join(scratch, 'fault'); shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(os.path.join(app, 'js'), os.path.join(work, 'js'))
    return work
def run(work):
    try: out = subprocess.run(['node', os.path.join(tests, 'merge_test.cjs'), work, plan, stock], capture_output=True, text=True, timeout=300, env={**os.environ, 'LRF_PAIRS': '40'}).stdout
    except subprocess.TimeoutExpired: out = ''
    return failed_lines(out)
STOPS = ('(the test stopped',)   # a check that only stops has named no line: that is not a catch

faults = [f for f in NODE if not words or any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
caught, missed, broken, already = [], [], [], None
if faults:
    names = run(copy())
    if names is None: print('with no fault in it the check gives no report: nothing can be shown to be caught', flush=True)
    else:
        already = set(names)
        if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
for n, (what, now, fault, line) in enumerate(faults):
    work = copy(); path = os.path.join(work, 'js', 'merge.js'); src = open(path, encoding='utf-8').read()
    if src.count(now) != 1:
        broken.append(what); print('BROKEN %d: %s -> the text to change is there %d times' % (n, what, src.count(now)), flush=True); continue
    open(path, 'w', encoding='utf-8').write(src.replace(now, fault))
    names = run(work) or []
    hit = [x for x in names if line.lower() in x.lower() and already is not None and x not in already and not x.startswith(STOPS)]
    (caught if hit else missed).append(what)
    print(('caught ' if hit else 'MISSED ') + '%d: %s -> ' % (n, what) + (hit[0][:140] if hit else 'failed lines: %s' % names[:4]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(caught) + len(missed) + len(broken), 'caught': len(caught), 'missed': missed, 'broken': broken}, ensure_ascii=False))
