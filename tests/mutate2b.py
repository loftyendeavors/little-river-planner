"""Deliberate faults in step 2b (the series tool, ghost bars, plantings to place), one at a time. Each must be caught by a named line of
waiting_test.cjs (the faults in the pure logic: quick) or of step2b_check.py (the faults in the page: about a minute each, stopped at the first line that fails).
usage: python3 -I mutate2b.py <app-dir> <scratch-dir> <waiting_test.cjs> <step2b_check.py> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
list: how many faults there are of each kind, and nothing else."""
import json, os, shutil, signal, subprocess, sys, time
app, scratch, node_test, page_check, plan = sys.argv[1:6]
rest = sys.argv[6:]; mode = rest.pop(0) if rest and rest[0] in ('node', 'page', 'list') else 'node'
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
N, P = 'node', 'page'
FAULTS = [
 # ── the pure logic ──
 (N, 'a planting that waits has its date moved by a day', 'js/succession.js', "const w = { ...base, id: newId(), date: E.d2s(date), wait:", "const w = { ...base, id: newId(), date: E.d2s(E.addDays(date, 1)), wait:"),
 (N, 'what finds no ground in the gardens named is dropped, not held', 'js/succession.js', "if (wave.short > EPS && (o.place === 'hold' || o.spill)) {", "if (wave.short > EPS && o.place === 'hold') {"),
 (N, 'a series asked to wait is placed in the gardens anyway', 'js/succession.js', "const place = o.place === 'hold' || o.place === 'beds' ? o.place : 'gardens';", "const place = o.place === 'beds' ? o.place : 'gardens';"),
 (N, 'a planting that waits keeps the length of the planting it copies', 'js/succession.js', "const SPACE_FIELDS = ['bedId', 'ft', 'startFt',", "const SPACE_FIELDS = ['bedId', 'startFt',"),
 (N, 'named beds are taken in the plan\'s order, not the order given', 'js/succession.js', ".sort((a, b) => order.get(a.id) - order.get(b.id));\n      if (!list.length) return { error: order.size", ";\n      if (!list.length) return { error: order.size"),
 (N, 'the feet a waiting planting asks for are ignored on a free bed', 'js/succession.js', "const soil = eng.isSoilBed(bed), own = soil && +w.ft > 0 ? +w.ft : null;", "const soil = eng.isSoilBed(bed), own = null;"),
 (N, 'a waiting planting lands a week after its own date', 'js/succession.js', "const bed = eng.bedOf(target.bedId), date = E.s2d(w.date), source = bare(w);\n    if (!bed || !isWaiting(w)) return { state: 'blocked', why: 'space' };", "const bed = eng.bedOf(target.bedId), date = E.addDays(E.s2d(w.date), 7), source = bare(w);\n    if (!bed || !isWaiting(w)) return { state: 'blocked', why: 'space' };"),
 (N, 'sharing by length gives up one foot more than was asked', 'js/succession.js', "const st = Rails.stretch(eng, holder.p, 'end', end - n);", "const st = Rails.stretch(eng, holder.p, 'end', end - n - 1);"),
 (N, 'sharing is offered where two crops hold the ground', 'js/succession.js', "const holder = others.length === 1 && !others[0].rest", "const holder = others.length >= 1 && !others[0].rest"),
 (N, 'sharing by rows gives the newcomer one row too many', 'js/succession.js', "const change = Rails.rowsChange(eng, holder.p, start, count - n, total);", "const change = Rails.rowsChange(eng, holder.p, start, Math.max(1, count - n - 1), total);"),
 (N, 'the list of where it could go ignores the season', 'js/succession.js', "if (res.state !== 'ok' || !res.r || seasonTrouble(eng, res.p, res.r) || !(res.r.harvestDays > 0)) continue;", "if (res.state !== 'ok' || !res.r || !(res.r.harvestDays > 0)) continue;"),
 (N, 'the gardens it was sent to do not come first', 'js/succession.js', "return out.sort((a, b) => rank(a.bed) - rank(b.bed) || (order.get", "return out.sort((a, b) => (order.get"),
 (N, 'a record with a bed is taken for a waiting planting', 'js/succession.js', "&& E.validDate(E.s2d(w.date)) && !w.bedId;", "&& E.validDate(E.s2d(w.date));"),
 (N, 'a newer backup loaded over the plan loses what was waiting', 'js/planio.js', "if (Array.isArray(mine.waiting) && mine.waiting.length) { keep.waiting = mine.waiting;", "if (Array.isArray(mine.waiting) && mine.waiting.length) {"),
 (N, '"where could it go" lists openings the crop does not fit', 'js/succession.js', "      const t = tryCrop(eng, o, crop, { varietyId: options.varietyId });\n      if (!t.ok) continue;", "      const t = tryCrop(eng, o, crop, { varietyId: options.varietyId });\n      if (!t.r) continue;"),
 (N, 'one left out as covered is not said to be left out', 'js/succession.js', "{ wave.skipped = 'covered'; wave.firstHarvest = then.r.first; remaining = 0; }", "{ wave.firstHarvest = then.r.first; remaining = 0; }"),
 # ── the page ──
 (P, 'a ghost bar is a planting that can be picked up', 'js/timeline.js', "cls: '.tl-ghost-bar', dataset: { ghost: p.id }, tries: namesOf(r.c), pictured: pictureOf(p), alt: r.c.name, title: `Not added yet:", "cls: '.tl-ghost-bar', dataset: { ghost: p.id, planting: p.id }, tries: namesOf(r.c), pictured: pictureOf(p), alt: r.c.name, title: `Not added yet:"),
 (P, 'ghost bars stay after the tool is closed', 'js/series.js', "if (now !== was) { was = now; App.emit('ghost'); }", "if (now !== was) { was = now; }"),
 (P, 'ghost bars are not drawn again when the form changes', 'js/series.js', "const refresh = () => { if (redrawPanel) redrawPanel(); App.emit('ghost'); };", "const refresh = () => { if (redrawPanel) redrawPanel(); };"),
 (P, 'the map does not mark the beds a series would plant', 'js/map.js', "willPlant.has(bed.id) ? 'will-plant' : '', named.has(bed.id)", "'', named.has(bed.id)"),
 (P, 'plantings asked to wait are put among the plan\'s plantings', 'js/app.js', "    if (held.length) ops.push(waitingOp([...waiting(), ...held]));", "    for (const w of held) ops.push({ before: null, after: w });"),
 (P, 'the header never says how many are waiting', 'js/series.js', "    badge.hidden = !n;", "    badge.hidden = true;"),
 (P, 'the count does not say "not counted here" on the views with totals', 'css/app.css', "body[data-view=\"sow\"] .wait-badge .wb-more, body[data-view=\"harvest\"] .wait-badge .wb-more, body[data-view=\"seeds\"] .wait-badge .wb-more, body[data-view=\"trays\"] .wait-badge .wb-more { display: inline; }", ""),
 (P, 'the timeline has no row for what waits', 'js/timeline.js', "    drawHead();\n    waitRows(body, eng, ghosts);", "    drawHead();"),
 (P, 'a file saved with nothing waiting inherits the list open here', 'js/app.js', "    if (own && carried.keep.waiting) { delete carried.keep.waiting; carried.notes = carried.notes.filter(n => !/waiting to be placed$/.test(n)); }", ""),
 (P, 'loading such a file does not say that what waits here will be gone', 'js/app.js', "const leftBehind = own && carried.keep.waiting && !ownKeep.waiting ? carried.keep.waiting.length : 0;", "const leftBehind = 0;"),
 (P, 'the waiting list is not written into the plan file', 'js/app.js', "for (const key of OWN_KEYS) if (mine[key] != null) keep[key] = mine[key];\n    plan.lrfNextKeep =", "for (const key of OWN_KEYS) if (key !== 'waiting' && mine[key] != null) keep[key] = mine[key];\n    plan.lrfNextKeep ="),
 (P, 'removing some of them removes all', 'js/app.js', "const gone = new Set(ids), list = waiting(), left = list.filter(w => !gone.has(w.id)), n = list.length - left.length;", "const gone = new Set(ids), list = waiting(), left = [], n = list.length - left.length;"),
 (P, 'a click on a waiting planting does not turn the map to its day', 'js/series.js', "if (!w) return; App.setDate(E.s2d(w.date)); App.select({ type: 'waiting', id: w.id }); };", "if (!w) return; App.select({ type: 'waiting', id: w.id }); };"),
 (P, 'a placed planting stays on the waiting list as well', 'js/app.js', "    ops.push(waitingOp(waiting().filter(x => x.id !== id)));", ""),
 (P, 'dragged onto the map it is planted on the map\'s day', 'js/app.js', "    const res = Ahead.landing(eng, w, target, { quick: !!target.survey }), unit", "    const res = Ahead.landing(eng, { ...w, date: E.d2s(state.date) }, target, { quick: !!target.survey }), unit"),
 (P, 'in the air its hint gives the page\'s day, not its own', 'js/drag.js', "    if (drag.base.waitingId) { const w = App.waitingOne(drag.base.waitingId); return w ? E.s2d(w.date) : App.state.date; }\n", ""),
 (P, 'a held bed is refused outright, with no question', 'js/app.js', "    if (result.state === 'blocked') { toast(result.why === 'held' ?", "    if (result.state === 'blocked' || result.state === 'split') { toast(result.why === 'held' ?"),
 (P, 'Cancel in the question places it by the first way', 'js/series.js', "h('button.btn', { type: 'button', id: 'shareCancel', onclick: () => done(null) }, 'Cancel')", "h('button.btn', { type: 'button', id: 'shareCancel', onclick: () => done(ways[0] ? ways[0].make(ways[0].def) : null) }, 'Cancel')"),
 (P, 'the x of the question places it by the first way', 'js/series.js', "id: 'shareClose', 'aria-label': 'Close', title: 'Close. Nothing is placed.', onclick: () => done(null) }", "id: 'shareClose', 'aria-label': 'Close', title: 'Close. Nothing is placed.', onclick: () => done(ways[0] ? ways[0].make(ways[0].def) : null) }"),
 (P, 'Place stays on for a number that cannot be given up', 'js/series.js', "          go.disabled = !made;", ""),
 (P, 'a click on a row selects the bed while the tool asks for beds', 'js/timeline.js', "      if (root.LRFSeries && root.LRFSeries.picking() && root.LRFSeries.toggleBed(row.dataset.bed)) return;", ""),
 (P, 'a click on a bed on the map selects it while the tool asks for beds', 'js/map.js', "    if (bedId && root.LRFSeries && root.LRFSeries.picking() && root.LRFSeries.toggleBed(bedId)) return;", ""),
 (P, 'a stray click on the photo closes the tool', 'js/map.js', "    else if (App.state.sel && App.state.sel.type !== 'series') App.select(null);", "    else if (App.state.sel) App.select(null);"),
 (P, 'opened from a bed, the tool does not name the bed', 'js/series.js', "if (S.suits(eng, crop, bed)) { P.place = 'beds'; P.bedIds = [bed.id]; } }", "}"),
 (P, 'a crop the space cannot take is named all the same', 'js/series.js', "    if (!S.suits(eng, crop, bed)) { toast(`${crop.name} cannot go in ${App.bedLabel(bed)}.`); return true; }", ""),
 (P, 'closing the tool forgets the planting it was opened from', 'js/series.js', "    P.back = sel && (sel.type === 'planting' || sel.type === 'bed') ? sel : null;", "    P.back = null;"),
 (P, 'the quick repeat is gone from a planting\'s panel', 'js/panels.js', "h('input', { type: 'number', id: 'fRepeatCount', min: 1, max: 30, value: 3, 'aria-label': 'How many more' }), h('span', 'more, every'),", "h('span', 'more, every'),"),
 (P, 'from an opening the series starts today, not on the opening\'s day', 'js/ahead.js', "varietyId: O.pick.varietyId || undefined, from: t.p.date, gardenId: o.garden.id })", "varietyId: O.pick.varietyId || undefined, gardenId: o.garden.id })"),
 (P, 'Escape does not leave the tool from inside a field', 'js/main.js', "else if (App.state.sel && (!typing || (App.state.sel.type === 'series' && e.target.closest && e.target.closest('#srForm')))) App.select(null); return; }", "else if (App.state.sel && !typing) App.select(null); return; }"),
 (P, 'a ghost bar shows the hand that picks a bar up', 'css/app.css', ".tl-bar.tl-ghost-bar { cursor: default; outline:", ".tl-bar.tl-ghost-bar { outline:"),
 (P, 'undo leaves a placed planting selected after it has gone back to wait', 'js/app.js', "    if (state.sel && state.sel.type === 'planting' && !state.engine.planting(state.sel.id)) select(null);\n    if (state.sel && state.sel.type === 'waiting' && !waitingOne(state.sel.id)) select(null);\n    toast(`Undid:", "    toast(`Undid:"),
]
if mode == 'list': print(json.dumps({k: len([f for f in FAULTS if f[0] == k]) for k in (N, P)})); sys.exit(0)
faults = [f for f in FAULTS if f[0] == mode and (not only or any(word in f[1] for word in only))]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
caught, missed, broken = [], [], []
for kind, name, rel, a, b in ([(mode, None, None, None, None)] if faults else []) + faults:
    work = os.path.join(scratch, 'mutant')
    shutil.rmtree(work, ignore_errors=True); shutil.copytree(app, work)
    if name is not None:
        p = os.path.join(work, rel); s = open(p, encoding='utf-8').read()
        if s.count(a) != 1: broken.append(name); print('BROKEN [' + kind + '] ' + name + ': the text to change is there %d times' % s.count(a), flush=True); continue
        open(p, 'w', encoding='utf-8').write(s.replace(a, b))
    if kind == N:
        run = subprocess.run(['node', node_test, work, plan], capture_output=True, text=True); out, err = run.stdout, run.stderr
    else:
        out, err = alone([sys.executable, '-I', page_check, work, os.path.join(scratch, 'mutant-shots')], 900, env={**os.environ, 'STOP_AT_FAIL': '1'})
    try: tail = json.loads(out.strip().split('\n')[-1])
    except Exception: tail = {'failed': [], 'crash': (err or out)[-300:]}
    named = [str(n.get('name')) if isinstance(n, dict) else str(n) for n in tail.get('failed') or []]; named = [n for n in named if 'ran to its end' not in n]   # a check that only stops has named no line: that is not a catch
    if name is None: already = unfaulted(named, 'crash' not in tail); continue
    fails = len(named); named = [n for n in named if already is not None and n not in already]
    (caught if named else missed).append(name)
    print(('caught ' if named else 'MISSED ') + '[' + kind + '] ' + name + ': ' + ('; '.join(map(str, named[:2]))[:220] if named else '(only what fails with no fault in it too)' if fails else '(no line of the check failed)' if 'crash' not in tail else '(the check stopped and named no line) <<' + tail['crash'].replace(chr(10), ' ')[-260:]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(faults), 'caught': len(caught), 'missed': missed, 'broken': broken}))
