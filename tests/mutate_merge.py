"""Deliberate faults in the joining of two copies of a plan (js/merge.js), and in the ids a live-tray demand plan gives what it
makes (js/trays.js, named as the fault's fifth part): each takes one rule or one guard out of a copy of the code, and a named line
of tests/merge_test.cjs must then fail where it passed before.

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
  ('who saved a file is reported as a box changed on both sides', "    if (alike(pat).some(p => QUIET.has(p))) return t;\n", "", 'a plan as a file holds it'),
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
  # things read together (S1c)
  ('a place written with * is matched only by a key named *', "(x === '*' ? !mine[i].endsWith('[]') : x === mine[i])", "(x === mine[i])", 'a job put off is taken whole'),
  ('a key that holds a dot is read as two keys', "join(ctx, pat ? pat + '.' + esc(key) : esc(key), path.concat(key), s[key], m[key], t[key]);", "join(ctx, pat ? pat + '.' + key : key, path.concat(key), s[key], m[key], t[key]);", 'a crop\'s selling line is taken whole'),
  ('what a file keeps of the planner\'s own record is not held to that record\'s rules', "{ p = 'lrfNext' + p.slice('lrfNextKeep.keep'.length); out.push(p); }", "{ p = 'lrfNext' + p.slice('lrfNextKeep.keep'.length); }", 'what the planner noted of an edit is taken whole'),
  ('a demand plan is joined row by row', ", 'liveTrayPlans[]']);", "]);", 'a live-tray demand plan is taken whole'),
  ('a nursery space\'s from and to are joined apart', "groupsOf(pat) ? together(ctx, pat, path, s || {}, m, t, {}) : undefined);", "undefined);", 'keys of one record that are read together'),
  ('keys read together, changed on both sides: nothing is said', "      if (!mt && !ms && !ts) said(ctx, { kind: 'same-box', path: path.concat(keys.join('+')),", "      if (false) said(ctx, { kind: 'same-box', path: path.concat(keys.join('+')),", 'keys of one record that are read together'),
  ('keys read together, changed on both sides: this device\'s stand', "      const from = mt || ms ? t : ts ? m : t;", "      const from = mt || ms ? t : m;", 'keys of one record that are read together'),
  ('a planting\'s yield is joined apart from its basis', "    together(ctx, pat, path, s0, m, t, special);\n", "", 'a yield is one value with its basis'),
  ('a device\'s own note of when it loaded the plan is reported', "'lrfNext.importedAt', ", "", 'what a device notes for itself'),
  ('the batches of a demand plan are left as joined', "settleTwins(ctx, start, mine, theirs, settleTrays(ctx, start, mine, theirs, plan))", "settleTwins(ctx, start, mine, theirs, plan)", 'the weekly batches follow the demand plan'),
  ('a batch sown here goes with the demand plan that did not stand', "      else if (Object.keys(doneOf(p)).length) { out.push(p); here.add(p.id); }", "      else if (false) { out.push(p); }", 'the weekly batches follow the demand plan'),
  ('a batch this device took out stays out though the cloud\'s plan stands', "if (planOf(q) === id && !here.has(q.id)) { out.push(q); here.add(q.id); tell(id, 'back', q.id); }", "if (false) { out.push(q); }", 'the weekly batches follow the demand plan'),
  ('a batch this device changed keeps its change though the cloud\'s plan stands', "const keep = same(work(p), work(own)) ? own : p;", "const keep = p;", 'the weekly batches follow the demand plan'),
  ('keys read together are joined apart on a planting that waits', "  const groupsOf = pat => { for (const p of alike(pat)) if (TOGETHER[p]) return TOGETHER[p]; return null; };", "  const groupsOf = pat => TOGETHER[pat] || null;", 'on a planting that waits to be placed too'),
  ('a demand plan kept though one device took it out keeps only part of its batches', "      else if (x.kind === 'kept') stands.set(String(x.path[1]).slice(1), x.removedBy === 'mine' ? 't' : 'm');\n", "", 'taken out on one device and changed on the other stays'),
  ('a demand plan this device changed, taken out there: the cloud\'s batches are taken as if its plan stood', "x.removedBy === 'mine' ? 't' : 'm');", "'t');", 'taken out on one device and changed on the other stays'),
  ('a batch taken off its plan here comes back beside itself', "      if (id == null) for (const side of [T, M]) { const q = side.get(p.id), qid = planOf(q); if (qid != null && sideOf(qid) === side) id = qid; }\n", "", 'no id twice'),
  ('a batch put back as the other device has it is not said', "if (keep === own && !same(p, own)) tell(id, 'reset', p.id); ", "", 'the weekly batches follow the demand plan'),
  ('two batches of one demand row and week both stand', "    if (!gone.size) return plan;\n    ctx.report.items = ctx.report.items.filter(x => !(x.kind === 'kept' && Array.isArray(x.path) && x.path[0] === 'plantings' && gone.has(x.id)));\n    return { ...plan, plantings: plan.plantings.filter(p => !gone.has(p.id)) };", "    return plan;", 'one demand row and one week is one batch'),
  ('of two batches of one row and week the cloud\'s stays, sown or not', "      const stay = worked.length ? worked : old.length ? old : [twins.find(p => T.has(p.id)) || twins[0]];", "      const stay = old.length ? old : [twins.find(p => T.has(p.id)) || twins[0]];", 'one demand row and one week is one batch'),
  ('a batch the start held stays beside the sown one', "      const stay = worked.length ? worked : old.length ? old : [twins.find(p => T.has(p.id)) || twins[0]];", "      const stay = worked.length ? [...new Set([...worked, ...old])] : old.length ? old : [twins.find(p => T.has(p.id)) || twins[0]];", 'the laptop changed its own unsown batch'),
  ('twins are left as joined', "settleTwins(ctx, start, mine, theirs, settleTrays(ctx, start, mine, theirs, plan))", "settleTrays(ctx, start, mine, theirs, plan)", 'when one device runs an older page'),
  ('of two batches of one row and week, each sown, one is dropped', "conflict: worked.length > 1 });", "conflict: false }); if (worked.length > 1) { gone.add(worked[0].id); }", 'both devices sowed their own batch'),
  ('two batches of one row and week: nothing is said', "      said(ctx, { kind: 'tray-batch-twice',", "      void ({ kind: 'tray-batch-twice',", 'one demand row and one week is one batch'),
  ('a demand plan stamped at two moments is reported as changed on both devices', "      if (same(bare(m), bare(t))) return stamp(m) > stamp(t) ? m : t;\n", "", 'stamped at its own moment'),
  ('a thing taken whole that a side only stamped again is changed there', "      if (isObj(s)) { if (same(bare(s), bare(t))) return m; if (same(bare(s), bare(m))) return t; }\n", "", 'changed and changed back'),
  ('a thing taken whole that the cloud only stamped again is changed there', "if (same(bare(s), bare(t))) return m; ", "", 'undo after a join'),
  ('a thing taken whole that this device only stamped again is changed there', " if (same(bare(s), bare(m))) return t; }", " }", 'changed and changed back'),
  # the ids a demand plan makes (js/trays.js)
  ('a new batch takes a random id again', "free(batchId(plan.id, b.key), x => taken.has(x))", "uid()", 'two devices that widen one demand plan alike make one record', 'trays.js'),
  ('a new batch takes its worked id though a plain planting holds it', "free(batchId(plan.id, b.key), x => taken.has(x))", "batchId(plan.id, b.key)", 'taken off its demand plan', 'trays.js'),
  ('a batch\'s id holds its demand plan\'s id unescaped', "'tray:' + encodeURIComponent(planId) + ':' + key", "'tray:' + planId + ':' + key", 'no two give one', 'trays.js'),
  ('the heated greenhouse benches take a random id', "free(POOL_ID, id => gardenIds.has(id))", "uid()", 'no heated greenhouse benches', 'trays.js'),
  ('the bed of the benches takes a random id', "free(POOL_BED_ID, id => bedIds.has(id))", "uid()", 'no heated greenhouse benches', 'trays.js'),
  ('a crop a demand row adds takes a random id', "const id = cropIdOf(r.name) ? free(cropIdOf(r.name), cropTaken) : uid();", "const id = uid();", 'is one crop', 'trays.js'),
  ('a crop a demand row adds takes its worked id though another crop holds it', "free(cropIdOf(r.name), cropTaken)", "cropIdOf(r.name)", 'under the next free id', 'trays.js'),
  ('a batch already in the plan takes the worked id', "const id = (original && original.id) || free(", "const id = free(", 'keeps every batch it had under its id', 'trays.js'),
  ('a joined plan that is the cloud\'s is not known as the cloud\'s', "    const alike = same(bare(r.plan), bare(theirs));", "    const alike = false;", 'three plans as files hold them'),
  ('who saved a file makes a joined plan differ from the cloud\'s', "    if (isObj(plan.lrfNextKeep)) out.lrfNextKeep = { keep: plan.lrfNextKeep.keep };\n", "", 'three plans as files hold them'),
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
for n, (what, now, fault, line, *where) in enumerate(faults):
    work = copy(); path = os.path.join(work, 'js', where[0] if where else 'merge.js'); src = open(path, encoding='utf-8').read()
    if src.count(now) != 1:
        broken.append(what); print('BROKEN %d: %s -> the text to change is there %d times' % (n, what, src.count(now)), flush=True); continue
    open(path, 'w', encoding='utf-8').write(src.replace(now, fault))
    names = run(work) or []
    hit = [x for x in names if line.lower() in x.lower() and already is not None and x not in already and not x.startswith(STOPS)]
    (caught if hit else missed).append(what)
    print(('caught ' if hit else 'MISSED ') + '%d: %s -> ' % (n, what) + (hit[0][:140] if hit else 'failed lines: %s' % names[:4]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(caught) + len(missed) + len(broken), 'caught': len(caught), 'missed': missed, 'broken': broken}, ensure_ascii=False))
