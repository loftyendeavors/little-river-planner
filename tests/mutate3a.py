"""Deliberate faults in step 3a (0.22), one at a time. Each must be caught by a named line.
usage: python3 -I mutate3a.py <app-dir> <scratch-dir> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
  node  faults in the engine, the audit and the plan file, against step3a_test.cjs (a few seconds each)
  page  faults in the page, against step3a_check.py (one to three minutes each: it stops at the first line that fails)
  list  how many faults there are of each kind, and nothing else"""
import json, os, shutil, signal, subprocess, sys, time
app, scratch, tests, plan = sys.argv[1:5]
mode = sys.argv[5] if len(sys.argv) > 5 else 'node'
only = sys.argv[6:]
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
 ('a figure for seed sown in place loses the whole nursery time', 'js/engine.js', "const off = Math.max(0, Math.round(basis === 'direct' ? less : nursery));", "const off = Math.max(0, Math.round(nursery));"),
 ('a figure from sowing keeps the nursery time', 'js/engine.js', "if (method !== 'TP' || (basis !== 'seed' && basis !== 'direct')) return { days: figure, off: 0, conversion: 'none' };", "if (method !== 'TP' || basis !== 'direct') return { days: figure, off: 0, conversion: 'none' };"),
 ('the crop’s starting point is ignored for printed days', 'js/engine.js', "set = !!(rule && rule.set) && source.said !== true;", "set = false;"),
 ('the crop’s starting point overrides a variety’s own word', 'js/engine.js', "set = !!(rule && rule.set) && source.said !== true;", "set = !!(rule && rule.set);"),
 ('a number of the grower’s own is not counted from the row’s start', 'js/engine.js', "return { ...e, dtm: Math.max(1, turn.days), assumed:", "return { ...e, dtm: typed, assumed:"),
 ('a number that leaves nothing for the bed gives no days at all', 'js/engine.js', "return { ...e, dtm: Math.max(1, turn.days), assumed:", "return { ...e, dtm: turn.days, assumed:"),
 ('the arithmetic with multipliers listens to the starting points', 'js/engine.js', "const x = !legacy && S.assumptions && S.assumptions.starts ? S.assumptions.starts[cropId] : null;", "const x = S.assumptions && S.assumptions.starts ? S.assumptions.starts[cropId] : null;"),
 ('a transplant saves 10 days, not 14', 'js/engine.js', "START_LESS = 14;", "START_LESS = 10;"),
 ('the days a transplant saves cannot be changed for a crop', 'js/engine.js', "less: less == null ? START_LESS : less, set: !!from", "less: START_LESS, set: !!from"),
 ('a bulb crop is given the choice', 'js/engine.js', "c.micro ? 'tray' : (c.plantingMaterial || c.material) === 'bulb' || c.plantingMaterial === 'plant' ? 'planted' : c.method === 'TP' ? null : 'sown';", "c.micro ? 'tray' : c.method === 'TP' ? null : 'sown';"),
 ('a default is not shown from the row’s start', 'js/engine.js', "const fallback = figure === 'supplier' ? ct.printed : inBedDays + off,", "const fallback = figure === 'supplier' ? ct.printed : inBedDays,"),
 ('the list does not say what a typed number comes to in the bed', 'js/engine.js', "days = mine ? Math.max(1, mine - off) : inBedDays;", "days = mine ? mine : inBedDays;"),
 ('recorded sowing and planting-out days are not used for the nursery time', 'js/engine.js', "return sow && field && s2d(field) >= s2d(sow) ? dayDiff(s2d(field), s2d(sow))\n        : isTower(b)", "return isTower(b)"),
 ('a guessed start is not marked as a guess', 'js/engine.js', "set ? 'crop' : stated ? 'variety' : basis !== 'unspecified' ? 'guess' : 'none'", "set ? 'crop' : stated ? 'variety' : 'none'"),
 ('printed days that leave nothing for the bed are used anyway', 'js/engine.js', "      if (turn.days < 1) return null;\n      return { days: turn.days, basis,", "      return { days: Math.max(1, turn.days), basis,"),
 ('an unknown starting point counts as one', 'js/engine.js', "const from = x && STARTS.includes(x.from) ? x.from : null, less =", "const from = x && x.from ? x.from : null, less ="),
 ('the guide gives kale the flowers’ rule', 'js/guide.js', "[/^kale\\b|kohlrabi|summer squash|zucchini/i, 'direct', 14,", "[/^kale\\b|kohlrabi|summer squash|zucchini/i, 'seed', null,"),
 ('a start is offered for a crop with no choice', 'js/engine.js', "return !legacy && c && !startFixed(c) && lib.guide && lib.guide.startFor ? lib.guide.startFor(c) : null;", "return !legacy && c && lib.guide && lib.guide.startFor ? lib.guide.startFor({ name: 'zinnia' }) : null;"),
 ('“from direct seeding” is read as sowing in the nursery', 'js/seedlib.js', "basis === 'seed' && /direct/i.test(String(statement || '')) ? 'direct' :", "false ? 'direct' :"),
 ('starting points are lost when a newer backup is loaded over the plan', 'js/planio.js', " + Object.keys(a.starts || {}).length + Object.keys(a.sell", " + Object.keys(a.sell"),
 ('tray batches are offered for release', 'js/audit.js', "const trayBatch = p => !!p.liveTray;", "const trayBatch = p => false;"),
 ('recorded work is offered for release', 'js/audit.js', "const recorded = p => !!p.done && E.DONE_KINDS.some(k => typeof p.done[k] === 'string' && p.done[k] !== '');", "const recorded = p => false;"),
 ('a planting let go keeps “manual”', 'js/audit.js', "delete q.dtm; if (q.timingMode === 'manual') delete q.timingMode; return q;", "delete q.dtm; return q;"),
 ('a number goes on the list without checking that no date moves', 'js/audit.js', "if (mine.every(x => same(x.a, x.b))) { c.ok = true; continue; }", "c.ok = true; continue;"),
 ('a number goes on the list though it moves another planting of the crop', 'js/audit.js', "const others = plan.plantings.filter(p => p.cropId === r.cropId && !ids.has(p.id)).every(p => same(eng.calc(p), sim.calc(sim.planting(p.id))));", "const others = true;"),
 ('“keep” is not kept', 'js/audit.js', "if (choice === 'keep') { if (later) r.ids.forEach(id => stays.add(id)); else kept += r.ids.length; continue; }", "if (choice === 'keep') { if (later) r.ids.forEach(id => stays.add(id)); else kept += r.ids.length; }"),
 ('double bookings already in the plan are counted as new', 'js/audit.js', "fresh = [...after].filter(k => !old.has(k)).map(k => k.split('|')),", "fresh = [...after].map(k => k.split('|')),"),
 ('a waiting planting is never let go', 'js/audit.js', "after: list.map(w => let_go.has(w.id) ? freed(w) : w) });", "after: list });"),
 ('a waiting planting follows the list whatever its twin does', 'js/audit.js', "r.choice = twin && twin.choice !== 'keep' ? 'follow' : 'keep';", "r.choice = 'follow';"),
 ('using the crop’s nursery weeks throws away the whole old copy', 'js/audit.js', "    const g = p.growingDefaults, crop = { ...g.crop };\n    delete crop.gh;\n    return { ...p, growingDefaults: { ...g, crop } };", "    const q = { ...p }; delete q.growingDefaults; return q;"),
 ('“take” is carried out for a row that cannot give its number', 'js/audit.js', "const choice = pick(r) === 'take' && !r.take ? 'keep' : pick(r), later =", "const choice = pick(r), later ="),
 ('the suggestion lets go a group whose dates would move', 'js/audit.js', "delete r.shifts;\n      r.choice = r.agrees ? 'follow' : r.take ? 'take' : 'keep';", "delete r.shifts;\n      r.choice = r.agrees || !r.take ? 'follow' : 'take';"),
 ('the preview misses dates that move', 'js/audit.js', "if (first || last || sow) moves.push({ id: p.id, first, last, sow });", "if (first > 0) moves.push({ id: p.id, first, last, sow });"),
 ('plantings on a guessed start are not counted', 'js/audit.js', "t.activeMode === 'catalog' && t.basisBy === 'guess'; });", "t.activeMode === 'catalog' && t.basisBy === 'never'; });"),
 ('plantings that agree with the list are not counted as agreeing', 'js/audit.js', "for (const p of o.days) if (same(eng.calc(p), bare.calc(bare.planting(p.id)))) agree++;", "for (const p of o.days) if (false) agree++;"),
]
PAGE = [
 ('choosing a starting point does nothing', 'js/assume.js', "if (!await App.setStart(c.id, { from: value === 'unset' ? null : value },", "if (!await Promise.resolve(false) && value === 'never' && !await App.setStart(c.id, { from: value === 'unset' ? null : value },"),
 ('a set row cannot be put back to not set', 'js/assume.js', ", rule.set ? h('option', { value: 'unset' }, 'Back to not set') : null);", ");"),
 ('the days a transplant saves are not there to change', 'js/assume.js', "const less = rule.from !== 'direct' ? null : h('label.as-less'", "const less = true ? null : h('label.as-less'"),
 ('a row set by the grower is not marked as his', 'js/assume.js', "h('select.as-from' + (rule.set ? '.mine' : ''), { 'aria-label': `${c.name}: days counted from`", "h('select.as-from', { 'aria-label': `${c.name}: days counted from`"),
 ('the variety’s own start is written to nothing', 'js/assume.js', "const value = e.target.value, after = { ...v, catalogMaturityBasis: value };", "const value = e.target.value, after = { ...v };"),
 ('“from seed” shows the days in the bed as the total', 'js/assume.js', "h('span', `${t.nursery} + ${t.bed} = `), h('b', String(t.total)));", "h('span', `${t.nursery} + ${t.bed} = `), h('b', String(t.bed)));"),
 ('a typed number’s note does not say what it comes to in the bed', 'js/assume.js', "const turned = t.off ? ` Counted from", "const turned = false ? ` Counted from"),
 ('an offer stays after it is taken', 'js/assume.js', "return hint && !rule.set && (hint.from !== 'transplant' || guessed) ? hint : null;", "return hint && (hint.from !== 'transplant' || guessed) ? hint : null;"),
 ('an offer is made to every row with a guide line, wanted or not', 'js/assume.js', "return hint && !rule.set && (hint.from !== 'transplant' || guessed) ? hint : null;", "return hint && !rule.set ? hint : null;"),
 ('taking every offer does not ask first', 'js/assume.js', "`${plural(offers.length, 'crop')}: days counted from where Johnny’s says`, { ask: true })", "`${plural(offers.length, 'crop')}: days counted from where Johnny’s says`)"),
 ('the question about every offer does not say what moves', 'js/app.js', "body: `${moves}. No ground ends up booked twice. One undo takes it all back.`, detail })", "body: `${moves}. No ground ends up booked twice. One undo takes it all back.` })"),
 ('the summary counts tray batches as keeping their own days', 'js/assume.js', "fig('own days', d.own,", "fig('own days', d.own + s.trays,"),
 ('Escape leaves the review window half open', 'js/assume.js', "{ id: 'auditDlg', oncancel: e => { e.preventDefault(); close(); } },", "{ id: 'auditDlg' },"),
 ('the × applies the step', 'js/assume.js', "title: 'Close. Nothing is changed.', onclick: () => close() }, '×'),", "title: 'Close. Nothing is changed.', onclick: () => apply.click() }, '×'),"),
 ('a row does not open on the suggested choice', 'js/assume.js', "h('option', { value, selected: choices[r.key] === value }, text)));\n      return h('tr.au-row'", "h('option', { value }, text)));\n      return h('tr.au-row'"),
 ('changing a row does not redraw what would move', 'js/assume.js', "onchange: e => { choices[r.key] = e.target.value; draw(); } }", "onchange: e => { choices[r.key] = e.target.value; } }"),
 ('the summary shows the old double bookings as new', 'js/assume.js', "fig('new double bookings', view.fresh.length, view.fresh.length > 0)", "fig('new double bookings', view.standing, view.fresh.length > 0)"),
 ('“Keep all” leaves Apply live', 'js/assume.js', "apply.disabled = !step.ops.length;", "apply.disabled = false;"),
 ('no snapshot is kept before the step', 'js/app.js', "    await snapshot('Before plantings followed the list');\n", ""),
 ('the step is not said in a toast', 'js/app.js', "    toast(`${label} · ${moved}${worth}`, { label: 'Undo', run: undo });\n    return { ...step, ...view };", "    return { ...step, ...view };"),
 ('the window does not say recorded work is left alone', 'js/assume.js', "${made.held ? `${plural(made.held, 'planting')} with recorded work", "${false ? `${plural(made.held, 'planting')} with recorded work"),
 ('waiting plantings are left out of the window', 'js/assume.js', "    section('To place', 'wait', 'waiting plantings that carry their own days');\n", ""),
 ('a column of the list is too narrow for its heading', 'css/app.css', ".view-assume .as th:nth-child(5) { width: 148px; }", ".view-assume .as th:nth-child(5) { width: 104px; }"),
 ('the days-less box runs into the next column', 'css/app.css', ".view-assume .as th:nth-child(2) { width: 196px; }", ".view-assume .as th:nth-child(2) { width: 150px; }"),
 ('a long crop name is cut short beside its offer', 'css/app.css', ".as-nc b { flex: none; overflow: visible; }", ".as-nc b { flex: 0 1 auto; }\n.as-nc { flex-wrap: nowrap !important; }"),
 ('a planting that follows the list does not say what came off', 'js/panels.js', "${c.assumed.off ? `. ${c.assumed.typed} days from", "${false ? `. ${c.assumed.typed} days from"),
 ('Seeds does not offer direct seeding', 'js/seeds.js', "const BASIS_SHORT = [['unspecified', 'as the crop'], ['seed', 'seeding'], ['direct', 'direct seeding'], ['transplant', 'transplanting']];", "const BASIS_SHORT = [['unspecified', 'as the crop'], ['seed', 'seeding'], ['transplant', 'transplanting']];"),
]
if mode == 'list': print(json.dumps({'node': len(NODE), 'page': len(PAGE)})); sys.exit(0)
faults = [f for f in (NODE if mode == 'node' else PAGE) if not only or any(word in f[0] for word in only)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
caught, missed, broken = [], [], []
for name, rel, a, b in ([(None, None, None, None)] if faults else []) + faults:
    work = os.path.join(scratch, 'mutant')
    shutil.rmtree(work, ignore_errors=True); shutil.copytree(app, work, ignore=shutil.ignore_patterns('thumbs.json', 'farm-map.jpg') if mode == 'node' else None)
    if name is not None:
        p = os.path.join(work, rel); s = open(p, encoding='utf-8').read()
        if s.count(a) != 1: broken.append(name); print('BROKEN ' + name + ': the text to change is there %d times' % s.count(a), flush=True); continue
        open(p, 'w', encoding='utf-8').write(s.replace(a, b))
    if mode == 'node':
        run = subprocess.run(['node', os.path.join(tests, 'step3a_test.cjs'), work, plan], capture_output=True, text=True); out, err = run.stdout, run.stderr
    else:
        seen = set()   # with no fault in it the check is run until it stops at nothing new: every line that fails by itself is then known, and none of them stops a faulted run short of the lines the fault is meant for
        while True:
            out, err = alone([sys.executable, '-I', os.path.join(tests, 'step3a_check.py'), work, os.path.join(scratch, 'mutant-shots')], 900, env={**os.environ, 'STOP_AT_FAIL': '1', 'GO_ON_AT': json.dumps(sorted(seen if name is None else already or []))})
            if name is not None: break
            try: more = {str(n.get('name')) if isinstance(n, dict) else str(n) for n in json.loads(out.strip().split('\n')[-1]).get('failed') or []} - seen
            except Exception: break
            if not more or len(seen) > 20: break
            seen |= more
    try: tail = json.loads(out.strip().split('\n')[-1])
    except Exception: tail = {'failed': [], 'crash': (err or out)[-300:]}
    named = [str(n.get('name')) if isinstance(n, dict) else str(n) for n in tail.get('failed') or []]; named = [n for n in named if 'ran to its end' not in n]   # a check that only stops has named no line: that is not a catch
    if name is None: already = unfaulted(named, 'crash' not in tail); continue
    fails = len(named); named = [n for n in named if already is not None and n not in already]
    (caught if named else missed).append(name)
    print(('caught ' if named else 'MISSED ') + name + ': ' + ('; '.join(map(str, named[:2]))[:200] if named else '(only what fails with no fault in it too)' if fails else '(no line of the check failed)' if 'crash' not in tail else '(the check stopped and named no line) <<' + tail['crash'].replace(chr(10), ' ')[-200:]), flush=True)
print(json.dumps({'mode': mode, 'faults': len(faults), 'caught': len(caught), 'missed': missed, 'broken': broken}))
