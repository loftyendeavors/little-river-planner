"""Deliberate faults for the plan's shape (tests/plan_shape.cjs): each puts one fault into a copy of the code or of the written
shape, and a named line must then fail where it passed before.
  node   tests/shape_test.cjs: a merge rule changed without the shape, the shape changed without the merge, the planner's own
         functions writing a field named nowhere, the shape losing an entry or a type, the check passing what it is there for
  page   tests/shape_check.py: a step of the page writing a field named nowhere, a new kind of step, a record kept beside the plan

usage: python3 -I mutate_shape.py <app-dir> <scratch-dir> <tests-dir> <plan.json> <inventory.json> <dir holding node_modules/acorn> [node | page | list] [words...]
       env FROM=, TO= to run a part
"""
import json, os, shutil, subprocess, sys
app, scratch, tests, plan, stock, mods = sys.argv[1:7]
mode = sys.argv[7] if len(sys.argv) > 7 else 'node'; words = [w.lower() for w in sys.argv[8:]]
SHAPE = 'tests/plan_shape.cjs'

# (what the fault is, the file, the text as it is, the text as the fault has it, words of the line that must fail)
NODE = [
  # the merge's rules changed, and the shape not
  ('a bed\'s place on the map is no longer taken whole by the merge', 'js/merge.js', "const WHOLE = new Set(['beds[].px', ", "const WHOLE = new Set([", 'whole: what js/merge.js takes whole'),
  ('the merge takes whole a place the shape joins by shape', 'js/merge.js', "const WHOLE = new Set(['beds[].px', ", "const WHOLE = new Set(['plantings[].tasks', 'beds[].px', ", 'whole: what js/merge.js takes whole'),
  ('the merge no longer keeps each side\'s seed lines', 'js/merge.js', "    'plantings[].workflow.seedUse': 'by the sowing each line belongs to'\n", "", 'kept: the lines js/merge.js keeps'),
  ('the merge takes nothing from the cloud quietly', 'js/merge.js', "const QUIET = new Set(['lrfNextKeep.device', 'lrfNextKeep.v']);", "const QUIET = new Set([]);", 'quiet: what js/merge.js takes'),
  ('the merge takes a new key for a stamp', 'js/merge.js', "const STAMPS = new Set(['updatedAt', 'savedAt']);", "const STAMPS = new Set(['updatedAt', 'savedAt', 'at']);", 'stamp: every place whose key'),
  ('a planting\'s containers are no longer part of its place', 'js/merge.js', "const PLACE = ['bedId', 'ft', 'startFt', 'bedLayout', 'seat']", "const PLACE = ['bedId', 'ft', 'startFt', 'bedLayout']", 'place: where a planting is'),
  ('a sowing day set by hand is no longer part of a planting\'s time', 'js/merge.js', "TIME = ['date', 'sowOn'];", "TIME = ['date'];", 'time: when a planting is'),
  ('the merge has a rule for a place the shape does not mark', 'js/merge.js', "'seedInventory.lots[].quantity': (ctx, pat, path, s, m, t) => t };", "'seedInventory.lots[].quantity': (ctx, pat, path, s, m, t) => t, 'settings.year': (ctx, pat, path, s, m, t) => t };", 'rule: what js/merge.js joins'),
  ('a planting\'s tasks are joined as part of a recording', 'js/merge.js', "const special = { done: Object.keys(done).length ? done : undefined };", "const special = { done: Object.keys(done).length ? done : undefined, tasks: m.tasks };", 'recording: what joinPlanting joins'),
  ('the planner keeps something new beside the plan', 'js/app.js', "const OWN_KEYS = ['crates', ", "const OWN_KEYS = ['extra', 'crates', ", 'the planner\'s own collections'),
  # the planner's own functions writing a field named nowhere
  ('a recorded job writes a field named nowhere on its planting', 'js/seedlib.js', "return { planting: { ...p, done, workflow }", "return { planting: { ...p, done, workflow, recordedOn: 'device' }", 'every kind of job, recorded'),
  ('a task put off writes a field named nowhere', 'js/week.js', "    if (Object.keys(tasks).length) out.tasks = tasks; else delete out.tasks;", "    if (Object.keys(tasks).length) out.tasks = { ...tasks, seen: true }; else delete out.tasks;", 'a job put off'),
  ('the variety editor writes a field named nowhere', 'js/seedlib.js', "latin: facts.latin || '', depth:", "latin: facts.latin || '', pageLanguage: 'en', depth:", 'a variety saved from a supplier page'),
  ('a crop added to the library carries a field named nowhere', 'js/seedlib.js', "rockwoolDays: 0, towerDays: 0 };", "rockwoolDays: 0, towerDays: 0, addedFrom: 'library' };", 'a crop added to the library'),
  ('a seed lot added writes a field named nowhere', 'js/seedlib.js', "    if (status !== 'ordered') lot.reviewedForYear = ctx.year;", "    if (status !== 'ordered') lot.reviewedForYear = ctx.year;\n    lot.addedBy = 'device';", 'seed lots added'),
  # the shape losing what it says, or the check what it is for
  ('the shape loses the day a delayed task stood on', SHAPE, "    'plantings[].tasks.delay.*.own': 'text',\n", "", 'a job put off'),
  ('the shape says a planting\'s length is text', SHAPE, "'plantings[].ft': 'number place',", "'plantings[].ft': 'text place',", 'the farm, as the planner holds it'),
  ('the shape leaves a list of objects without ids with no word for how it is joined', SHAPE, "'varieties[].supplierPacks': 'lines whole',", "'varieties[].supplierPacks': 'lines',", 'a list of objects without ids'),
  ('the shape names a type nobody knows', SHAPE, "'plantings[].note': 'text',", "'plantings[].note': 'words',", 'the written shape can be read'),
  ('an entry hangs from nothing', SHAPE, "    'plantings[].tasks': 'object',\n", "", 'every entry hangs from a place'),
  ('the check passes a field named nowhere', SHAPE, "      if (!e) { say(unknown, { path, place: at }); return; }", "      if (!e) return;", 'and a field named nowhere is found'),
  ('the check passes a record without an id', SHAPE, "if (!isObj(x) || !usable(x.id) || seen.has(x.id)) say(wrong,", "if (false) say(wrong,", 'a record without an id'),
  ('the check passes over the attic in a plan as the planner holds it', SHAPE, "const unknown = [], wrong = [], limit = options.limit || 50, core = options.attic ?", "const unknown = [], wrong = [], limit = options.limit || 50, core = true ?", 'passed over in a file and nowhere else'),
]
PAGE = [
  ('a planting edited by the page takes a field named nowhere', 'js/app.js', "  const changed = (record, change) => { const after = { ...record };", "  const changed = (record, change) => { const after = { ...record, touched: true };", 'every record each step of the tour wrote'),
  ('the page learns a kind of step the tour does not make', 'js/app.js', "      if (op.kind === 'settings') { next.settings = to; continue; }", "      if (op.kind === 'settings') { next.settings = to; continue; }\n      if (op.kind === 'notes') { next.notes = to; continue; }", 'every kind of step withOps applies'),
  ('a planting waiting to be placed is no longer read as a planting', SHAPE, "'lrfNext.waiting[]': 'plantings[]' };", "};", 'the plan as the page holds it fits'),
  ('the benches, when changed, carry a field named nowhere', 'js/app.js', "    const after = { ...changed, lrfEdited: true };", "    const after = { ...changed, lrfEdited: true, editedOn: 'device' };", 'the plan as the page holds it fits'),
]
if mode == 'list': print(json.dumps({'node': len(NODE), 'page': len(PAGE)})); sys.exit(0)
LIST = NODE if mode == 'node' else PAGE

def failed_lines(out):
    i = out.rfind('{"passed"')
    if i < 0: return None
    try: return [str(x) for x in json.loads(out[i:].split('\n')[0])['failed']]
    except Exception: return None
def copy():
    work = os.path.join(scratch, 'fault'); shutil.rmtree(work, ignore_errors=True)
    if mode == 'page': shutil.copytree(app, work, ignore=shutil.ignore_patterns('fault'))
    else: shutil.copytree(os.path.join(app, 'js'), os.path.join(work, 'js'))
    os.makedirs(os.path.join(work, 'tests'), exist_ok=True)
    for f in ('plan_shape.cjs', 'shape_test.cjs', 'shape_check.py'): shutil.copy(os.path.join(tests, f), os.path.join(work, 'tests', f))
    return work
def run(work):
    if mode == 'page': cmd = ['python3', '-I', os.path.join(work, 'tests', 'shape_check.py'), work, os.path.join(scratch, 'fault-shots'), work]
    else: cmd = ['node', os.path.join(work, 'tests', 'shape_test.cjs'), work, plan, stock, mods]
    try: out = subprocess.run(cmd, capture_output=True, text=True, timeout=300).stdout
    except subprocess.TimeoutExpired: out = ''
    return failed_lines(out)
STOPS = ('(the test stopped',)   # a check that only stops has named no line: that is not a catch

faults = [f for f in LIST if not words or any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
caught, missed, broken, already = [], [], [], None
if faults:
    names = run(copy())
    if names is None: print('with no fault in it the check gives no report: nothing can be shown to be caught', flush=True)
    else:
        already = set(names)
        if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
for n, (what, file, now, fault, line) in enumerate(faults):
    work = copy(); path = os.path.join(work, file); src = open(path, encoding='utf-8').read()
    if src.count(now) != 1:
        broken.append(what); print('BROKEN %d: %s -> the text to change is there %d times' % (n, what, src.count(now)), flush=True); continue
    open(path, 'w', encoding='utf-8').write(src.replace(now, fault))
    names = run(work) or []
    hit = [x for x in names if line.lower() in x.lower() and already is not None and x not in already and not x.startswith(STOPS)]
    (caught if hit else missed).append(what)
    print(('caught ' if hit else 'MISSED ') + '%d: %s -> ' % (n, what) + (hit[0][:140] if hit else 'failed lines: %s' % names[:4]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(caught) + len(missed) + len(broken), 'caught': len(caught), 'missed': missed, 'broken': broken}, ensure_ascii=False))
