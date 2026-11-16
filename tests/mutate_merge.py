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
  ('the same box changed on both sides: this device\'s value stands', "    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });\n    return t;\n  }\n  function joinObject", "    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });\n    return m;\n  }\n  function joinObject", 'the same box changed to different values'),
  ('the same box changed on both sides is not reported', "    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });\n    return t;\n  }\n  function joinObject", "    return t;\n  }\n  function joinObject", 'the same box changed to different values'),
  ('taken out here and changed there: it goes', "      else if (!same(S.get(rec.id), rec)) { out.push(rec); said(ctx, { kind: 'kept', path: here, id: rec.id, removedBy: 'mine' }); }", "", 'taken out on one side, changed on the other'),
  ('taken out there and changed here: it goes', "      else if (!same(S.get(rec.id), rec)) { out.push(rec); said(ctx, { kind: 'kept', path: here, id: rec.id, removedBy: 'theirs' }); }", "", 'taken out on one side, changed on the other'),
  ('a record this device added is dropped', "      if (!S.has(rec.id)) out.push(rec);                                         // this device added it\n      else if", "      if (!S.has(rec.id)) { /* dropped */ }\n      else if", 'a record added on each side'),
  ('a record the cloud added is dropped', "      else if (!S.has(rec.id)) out.push(rec);                                    // the cloud added it", "      else if (!S.has(rec.id)) { /* dropped */ }", 'a record added on each side'),
  ('a bed\'s place on the map is joined half from each side', "const WHOLE = new Set(['beds[].px', ", "const WHOLE = new Set([", 'a thing taken whole'),
  ('of two stamps the earlier is kept', "return m > t ? m : t;", "return m > t ? t : m;", 'a stamp: the later one'),
  ('a planting\'s place is joined box by box', "const PLACE = ['bedId', 'ft', 'startFt', 'bedLayout', 'seat'], TIME", "const PLACE = [], TIME", 'a planting\'s place is one value'),
  ('one sowing ticked on both: this device\'s seed stays on the planting', ".concat(minus(minus(um, us), ut).filter(x => !dropped.has(batchOf(x))));", ".concat(minus(minus(um, us), ut));", 'one sowing ticked on both devices draws seed once'),
  ('one sowing ticked on both: this device\'s line of history stays', ".concat(minus(minus(hm, hs), ht).filter(x => !lost.has(kindOf(x))));", ".concat(minus(minus(hm, hs), ht));", 'one sowing ticked on both devices draws seed once'),
  ('one sowing ticked on both: this device\'s day stands over the cloud\'s', "        lost.add(kind);\n", "        lost.add(kind); pick = jm;\n", 'one sowing ticked on both devices draws seed once'),
  ('a sowing recorded on both is not reported', "        said(ctx, { kind: 'recorded-twice', path, id, job: kind, mine: jm ? jm.date : null, theirs: jt ? jt.date : null });\n", "", 'one sowing ticked on both devices draws seed once'),
  ('a move made on the other device is applied over recorded work', "const side = theirsRecorded ? 't' : mineStands ? 'm' : '';", "const side = '';", 'the recorded bed and day stand'),
  ('seed: a change the cloud already holds is counted again', "if (!theirs.has(e.id) && !first.has(e.id)) add(e, 1);", "if (!first.has(e.id)) add(e, 1);", 'the same count of a lot seen twice'),
  ('seed: a count undone here stays', "    for (const e of listOf(start, 'adjustments')) if (theirs.has(e.id) && !mine.has(e.id)) add(e, -1);\n", "", 'a count undone here'),
  ('seed: a sowing\'s draw is counted from the log and from the planting', "(!all && ofSowing(e))", "(false)", 'a sowing ticked here while the cloud'),
  ('seed: a sowing taken back is counted from the log and from the planting', " || (e.kind === 'count' && /^Sowing \\S+ taken back: /.test(String(e.reason || '')))", "", 'its seed is back on the lot, once'),
  ('seed: counted by hand on both sides, both are applied', "      if (own && theirsOnly.get(lot.id)) { own = 0; clash = true; }   // counted by hand on both sides: the cloud's count stands\n", "", 'a lot counted by hand on both devices'),
  ('seed: the seed of this device\'s sowings is not taken off the lot', " - (dP.get(lot.id) || 0)), clash,", "), clash,", 'two sowings of one variety'),
  ('seed: a lot goes below zero', "      if (q < -1e-6) {\n", "      if (false) {\n", 'more drawn on two devices than a lot holds'),
  ('seed: an overdraw is not reported', "        said(ctx, { kind: 'seed-short', path: ['seedInventory', 'lots', '#' + lot.id], id: lot.id, short: whole });\n", "", 'more drawn on two devices than a lot holds'),
  ('seed: this device\'s log is not held to its counts', "throw new Error('The seed on hand here does not follow its own record of changes.');", "void 0;", 'its own log does not account for'),
  ('a planting is left both on its bed and waiting', "const twice = isObj(w) && placed.has(w.id) && !(before.has(w.id) && stillTheirs.has(w.id));", "const twice = false;", 'a planting put on a bed on one side'),
  ('test 1 is not made: a plan that does not read back is used', "    if (!same(JSON.parse(text), plan)) return 'The joined plan does not read back as it was written.';\n", "", '1. a joined plan that does not open'),
  ('test 2 is not made: an id twice', "const twice = repeats(list); if (twice != null && !why", "const twice = null; if (twice != null && !why", '2. an id there twice'),
  ('test 3 is not made: a changed record missing', "for (const rec of list) if ((!was.has(rec.id) || !same(was.get(rec.id), rec)) && !(now && now.has(rec.id))", "for (const rec of list) if (false && !(now && now.has(rec.id))", '3. a record one side changed'),
  ('test 4 is not made: a recorded day missing', "        if (!joined || !same(doneOf(joined)[kind], date)) return", "        if (false) return", '4. a day of recorded work'),
  ('test 5 is not made: seed that does not add up', "        if (!near(num(lot.quantity), Math.max(0, to.q))) return", "        if (false) return", '5. seed that does not add up'),
  ('test 5 is not made: two sowings\' seed on one planting', "        if (n(p) > Math.max(1, n(M.get(p.id)), n(T.get(p.id)))) return", "        if (false) return", '5. a planting that draws seed for two sowings'),
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
