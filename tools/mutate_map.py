"""Deliberate faults in the map build, each of which a named check has to catch.

usage: python3 -I mutate_map.py <app-dir> <scratch-dir> <tests-dir> [node | page] [words...]
  node: faults in js/mapgeo.js, caught by mapgeo_test.cjs (seconds each)
  page: faults in map.js, mapedit.js, app.js, panels.js and the style sheet, caught by map_check.py (about a minute each).
        FROM=0 TO=5 runs a slice of them. The page run ends each fault with pkill google-chrome: run it alone.
A fault that no named line catches is a hole in the checks, and is reported as MISSED.
"""
import json, os, shutil, subprocess, sys

app, scratch, tests = [os.path.abspath(a) for a in sys.argv[1:4]]
mode = sys.argv[4] if len(sys.argv) > 4 else 'node'
words = [w.lower() for w in sys.argv[5:]]

NODE = [
    ('a quarter turn is not taken as the same line', 'return Math.min(d, 90 - d); };', 'return d; };', 'quarter turn still lies'),
    ('frames are not set upright', "const upright = angle => { const a = (((angle + 45) % 90) + 90) % 90 - 45; return Object.is(a, -0) ? 0 : a; };", "const upright = angle => angle;", 'set upright'),
    ('a turned bed keeps its unturned box', 'return [(c * shape.W + s * shape.L) / 2, (s * shape.W + c * shape.L) / 2];', 'return [shape.W / 2, shape.L / 2];', 'as wide as it was long'),
    ('touching counts as overlapping', 'if (a1 <= b0 || b1 <= a0) return false;', 'if (a1 < b0 || b1 < a0) return false;', 'share an edge'),
    ('only the first bed’s sides are tried', 'for (const poly of [A, B]) {\n      for (let i = 0; i < 2; i++) {', 'for (const poly of [A]) {\n      for (let i = 0; i < 2; i++) {', 'a side of either one'),
    ('towers judged as squares', 'if (p.round && q.round) return Math.hypot(p.x - q.x, p.y - q.y) < (p.W + q.W) / 2;', '', 'judged as circles'),
    ('an old overlap is not left alone', 'return still.filter(s => overlaps(after, s, slack) && !(before && overlaps(before, s, slack)));', 'return still.filter(s => overlaps(after, s, slack));', 'came with the plan'),
    ('paths read between beds that share no length', 'const next = sorted.slice(i + 1).find(o => o[b0] < sorted[i][b1] && sorted[i][b0] < o[b1] && o[a0] >= sorted[i][a1] - 1e-6);', 'const next = sorted.slice(i + 1).find(o => o[a0] >= sorted[i][a1] - 1e-6);', 'share no length'),
    ('a path kept with any bed, not the next one', "if (key === a0 && s === before) for (const gap of gapsBefore)", "if (key === a0 && s[b0] < mv[b1] && mv[b0] < s[b1]) for (const gap of (paths[axis] || []).concat(gapsBefore))", 'next space along'),
    ('the row’s own path is not carried on', "return gap > 1e-6 ? [gap] : paths[axis] || [];", "return paths[axis] || [];", 'row’s own path'),
    ('middles line up with edges', 'if ((key === a) !== (k === a)) continue;', '', 'a middle only'),
    ('a turn ignores the neighbours', 'for (const o of others) for (let k = 0; k < 4; k++) tryAt(o + 90 * k);', '', 'neighbour’s line'),
    ('a turn does not settle on whole degrees', "return best == null ? { angle: turn(Math.round(angle)), snapped: false }", "return best == null ? { angle: turn(angle), snapped: false }", 'whole degree'),
    ('lining up goes to the far edge', "const b = box(shape, angle), d = all[where] - b[where];", "const b = box(shape, angle), d = all[where[0] + '1'] - b[where];", 'starting on the same line'),
    ('even spacing forgets the beds’ own widths', 'const gap = path != null ? path : (rows[rows.length - 1].b[a1] - rows[0].b[a0] - sizes) / (rows.length - 1);', 'const gap = path != null ? path : (rows[rows.length - 1].b[a1] - rows[0].b[a0]) / (rows.length - 1);', 'keeps the two ends'),
    ('rows flip a bed end for end', "const rot = offAxis(shape.rot || 0, angle) < 1e-6 ? shape.rot || 0 : angle,", "const rot = angle,", 'keeps its own turn'),
    ('rows forget the end gap', 'v += tallest + endGap;', 'v += tallest;', 'past the end gap'),
    ('a turned group does not turn its beds', 'out.set(shape.id, { x: cx + x, y: cy + y, rot: turn((shape.rot || 0) + by) });', 'out.set(shape.id, { x: cx + x, y: cy + y, rot: shape.rot || 0 });', 'turned a quarter turn'),
    ('a stretched bed grows from its middle', "return { ...shape, x: shape.x + x, y: shape.y + y, W: along ? shape.W : grown, L: along ? grown : shape.L };", "return { ...shape, W: along ? shape.W : grown, L: along ? grown : shape.L };", 'leaves the other end'),
    ('a block is filled without counting the last path', 'Math.floor((span + pathFt + 1e-9) / (bedFt + pathFt))', 'Math.floor((span + 1e-9) / (bedFt + pathFt))', 'short way'),
    ('lengths are not brought to half feet', 'const length = Math.floor(run / roundTo + 1e-9) * roundTo;', 'const length = run;', 'whole half feet'),
    ('the beds of a block are not centred', 'const offset = (-used / 2 + bedFt / 2 + i * (bedFt + pathFt)) * pxPerFt;', 'const offset = (bedFt / 2 + i * (bedFt + pathFt)) * pxPerFt;', 'centred in the block'),
    ('the next bed ignores the row’s step', "if (Math.hypot(dx, dy) > 1e-6 && offAxis(last.rot || 0, prev.rot || 0) < 2) return { x: last.x + dx, y: last.y + dy, rot: last.rot || 0 };", "", 'one step past the last'),
    ('a name in use is given again', "if (!used.has(name)) { used.add(name); out.push(name); }", "out.push(name);", 'already in use'),
    ('beds are numbered across only', "return rows.sort((p, q) => (Math.abs(p.b.v - q.b.v) > tall / 2 ? p.b.v - q.b.v : p.b.u - q.b.u)).map(r => r.shape);", "return rows.sort((p, q) => p.b.u - q.b.u).map(r => r.shape);", 'numbered as they read'),
    ('containers are never given up', 'if (other.item.from <= item.to && item.from <= other.item.to) for (const i of other.at) taken[i] = 1;', 'for (const i of other.at) taken[i] = 1;', 'finished one left'),
    ('a place chosen by hand is taken even when held', 'if (want > 0 && Number.isInteger(item.pin) && freeRun(item.pin)) at = item.pin;', 'if (want > 0 && Number.isInteger(item.pin) && item.pin + want <= size) at = item.pin;', 'already stands there'),
    ('crops are seated by name', "const order = [...items].sort((a, b) => a.from - b.from || String(a.id).localeCompare(String(b.id)))", "const order = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)))", 'not by its name'),
    ('a crop with no run long enough gets nothing', "else for (let i = 0; i < size && mine.length < want; i++) if (!taken[i]) mine.push(i);", "", 'free containers there are'),
    ('the photo’s scale is upside down', 'return px > 0 && feet > 0 ? feet / px : null;', 'return px > 0 && feet > 0 ? px / feet : null;', 'two points'),
]

# (name, file, find, replace, words of the check that must fail)
PAGE = [
    ('the view jumps instead of gliding', 'js/map.js', "if (calm() || !(ms > 0) || !rect.width) {", "if (true) {", 'zoom button is eased'),
    ('the mouse wheel lags a frame behind the hand', 'js/map.js', "function onWheel(e) { e.preventDefault(); settle(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016))); }", "function onWheel(e) { e.preventDefault(); settle(); const x = e.clientX, y = e.clientY, f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)); requestAnimationFrame(() => zoomAt(x, y, f)); }", 'mouse wheel zooms at once'),
    ('the mouse wheel is eased like a button', 'js/map.js', "function onWheel(e) { e.preventDefault(); settle(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016))); }", "function onWheel(e) { e.preventDefault(); view.moved = true; glide(zoomed(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016))), 200); }", 'mouse wheel zooms at once'),
    ('a notch of the wheel is a larger step than it was', 'js/map.js', "zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016))); }", "zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0024))); }", 'mouse wheel zooms at once'),
    ('the wheel zooms about the middle of the map', 'js/map.js', "function onWheel(e) { e.preventDefault(); settle(); zoomAt(e.clientX, e.clientY, Math.exp(", "function onWheel(e) { e.preventDefault(); settle(); const r = $('map').getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, Math.exp(", 'zooms about the pointer'),
    ('a resized window is not fitted again', 'js/map.js', "(!view.fitted || !view.moved)) fit();", "!view.fitted) fit();", 'made smaller is fitted again'),
    ('a moved view is fitted over', 'js/map.js', "view.x = to.x; view.y = to.y; view.z = to.z; view.moved = true;\n    applyView();", "view.x = to.x; view.y = to.y; view.z = to.z;\n    applyView();", 'zoomed is left alone'),
    ('crates are filled in order of the day again', 'js/map.js', "const c = geo.cells, mine = seatsOf(bed, c.count).get(id) || [], group", "const c = geo.cells, mine = Array.from({ length: Math.min(c.count - used, Math.max(1, Math.round(r.len))) }, (_, i) => used + i), group", 'keeps the same containers'),
    ('a crop is set down on containers that are held', 'js/map.js', "free: got.length === now.length && got[0] === start && got[got.length - 1] === start + now.length - 1 };", "free: true };", 'went in earlier holds'),
    ('a crop dragged in its own group goes nowhere', 'js/map.js', "if (to && spot.bedId === to.p.bedId) {", "if (false) {", 'could be dragged to free containers'),
    ('the edit of the map’s own settings is not an edit', 'js/app.js', "if (op.kind === 'map') { next.map = to || {}; continue; }   // the photo's scale and the like (mapedit.js)", "if (op.kind === 'map') { continue; }", 'sets the photo’s scale'),
    ('the plan’s panel stays up while the ground is edited', 'css/app.css', "body[data-layout] .library > :not(#layoutSide), body[data-layout] #inspectorBody { display: none; }", "body[data-layout] .library > :not(#layoutSide) { display: none; }", 'turns the map into a drawing'),
    ('the map pans under a bed being dragged', 'js/mapedit.js', "    e.stopImmediatePropagation(); e.preventDefault();\n    settleNudge();", "    settleNudge();", 'stays still while a bed is dragged'),
    ('nothing lines up', 'js/mapedit.js', "return Geo.snap(box, still, 7 / M.zoom(),", "return Geo.snap(box, [], 7 / M.zoom(),", 'settles on the row’s own path'),
    ('one space may lie on another', 'js/mapedit.js', "      const hit = Geo.newOverlaps(shape, M.shapeOf(id), still, slack);\n      if (hit.length) return { id, on: hit[0].id };", "", 'dropped on its neighbour goes back'),
    ('an end is dragged in tenths', 'js/mapedit.js', "const step = e.altKey ? 0.1 : 0.5,", "const step = 0.1,", 'lengthens the bed by 3 ft'),
    ('a stretched bed grows both ways', 'js/mapedit.js', "const grown = Geo.stretch(x, d.side, ft * k - size);", "const grown = { ...x, [along ? 'L' : 'W']: ft * k };", 'the other end stays'),
    ('a neighbour’s length is not taken', 'js/mapedit.js', "if (hit) { ft = hit.v; same = hit.b; }", "", 'takes theirs'),
    ('a group turns each bed about itself', 'js/mapedit.js', "d.after = new Map([...Geo.turnAbout([...d.before.values()], d.cx, d.cy, by)].map(([id, p]) => [id, { ...d.before.get(id), ...p }]));", "d.after = new Map([...d.before].map(([id, x], i) => [id, { ...x, rot: Geo.turn(x.rot + by + i) }]));", 'turns as one'),
    ('the arrows move the planning date as well', 'js/mapedit.js', "      stop();   // while the layout is being edited the arrows move ground, not the planning date", "", 'leave the planning date alone'),
    ('every arrow press is its own step', 'js/mapedit.js', "clearTimeout(n.timer); n.timer = setTimeout(settleNudge, 650);", "settleNudge();", 'as one step once the keys rest'),
    ('a copy keeps the name it was copied from', 'js/mapedit.js', "name = Geo.nextNames(taken, 1, String(bed.bed))[0]; taken.push(name);", "taken.push(name);", 'sets down a copy'),
    ('Alt-drag moves the bed itself', 'js/mapedit.js', "const done = d.copy ? copyTo(d.ids, d.after) : change(", "const done = false ? copyTo(d.ids, d.after) : change(", 'sets down a copy'),
    ('a bed with plantings can be removed', 'js/mapedit.js', "const held = beds.map(b => ({ b, n: eng().plantingsIn(b.id).length })).filter(x => x.n);", "const held = [];", 'holds plantings cannot be removed'),
    ('the next bed is set on top of the last', 'js/mapedit.js', "const at = Geo.nextInRow(lined, typical().pathFt * k),", "const at = { x: lined[lined.length - 1].x + 400, y: lined[lined.length - 1].y, rot: lined[lined.length - 1].rot },", 'one step past the end of the row'),
    ('a block over taken ground can be made', 'js/mapedit.js', "disabled: !made.beds.length || !!made.on, onclick: createGarden }", "disabled: !made.beds.length, onclick: createGarden }", 'cannot be made'),
    ('a new garden’s beds are not numbered', 'js/mapedit.js', "bed: String(i + 1), gardenId: garden.id, type: 'IG'", "bed: '1', gardenId: garden.id, type: 'IG'", 'creates the garden and its beds'),
    ('spacing ignores the figure typed', 'js/mapedit.js', "act('leSpread', 'Space them this far apart', 'Side by side, each a path from the last; the first one stays', () => spaceOut('u', +across.value)),", "act('leSpread', 'Space them this far apart', 'Side by side, each a path from the last; the first one stays', () => spaceOut('u', 1)),", 'sets every path to the figure typed'),
    ('numbering follows the order of picking', 'js/mapedit.js', "const list = Geo.reading(shapes(S.picked), frameNow()), changes = new Map();", "const list = shapes(S.picked), changes = new Map();", 'Number in order'),
    ('a typed width may lay beds on each other', 'js/mapedit.js', "    const bad = clash(after, false);\n    if (bad) { toast(`${clashText(bad)} at that size: nothing was changed.`); refresh(); return; }\n    if (!change(`Change ${describe(beds.map(b => b.id))}", "    if (!change(`Change ${describe(beds.map(b => b.id))}", 'would lay the beds on each other'),
    ('drawing a garden smaller changes its beds’ real width', 'js/mapedit.js', "if (!change(`Draw ${garden.name} at ${num(percent, 1)}%`, new Map([...moves].map(([id, p]) => [id, p])),", "if (!change(`Draw ${garden.name} at ${num(percent, 1)}%`, new Map([...moves].map(([id, p]) => [id, { ...p, w: round2(bedOf(id).w * k / was) }])),", 'real sizes do not change'),
    ('the measure reads map pixels', 'js/mapedit.js', "const feetBetween = t => `${num(Math.hypot(t.a[0] - t.b[0], t.a[1] - t.b[1]) * M.feetPerPx(), 1)} ft`;", "const feetBetween = t => `${num(Math.hypot(t.a[0] - t.b[0], t.a[1] - t.b[1]), 1)} ft`;", 'reads its length in feet'),
    ('Escape leaves the mode with a bed still picked', 'js/mapedit.js', "      else if (S.picked.length) pick([]);\n      else close();", "      else close();", 'stays in the mode'),
    ('Escape in the new garden’s form only leaves the field', 'js/mapedit.js', "else if (S.tool || S.draft || S.tape) { if (typing) e.target.blur(); S.tool = null; S.draft = null; S.tape = null; refresh(); }", "else if (typing) e.target.blur();\n      else if (S.tool || S.draft || S.tape) { S.tool = null; S.draft = null; S.tape = null; refresh(); }", 'leaves the new garden without making it'),
    ('leaving the mode leaves the map locked', 'js/mapedit.js', "    delete document.body.dataset.layout;\n    M.lock(false);", "    delete document.body.dataset.layout;", 'opens its panel as before'),
    ('the bed’s panel has no way into the mode', 'js/panels.js', "if (root.LRFMapEdit && (soil || !eng.isPool(bed))) host.append(h('p.insp-aside', h('button.link', { type: 'button', id: 'bedLayoutEdit',", "if (false) host.append(h('p.insp-aside', h('button.link', { type: 'button', id: 'bedLayoutEdit',", 'opens the mode with that bed picked'),
    ('a length can be typed in the bed’s panel again', 'js/panels.js', "h('div.stats.dims', { id: 'bedDims', 'aria-label': 'Size of this space' }, dims),", "h('div.stats.dims', { id: 'bedDims', 'aria-label': 'Size of this space' }, dims), soil ? h('input', { type: 'number', id: 'fBedL', value: bed.l, onchange: e => App.updateBeds([bed.id], { l: +e.target.value }, 'Change length') }) : null,", 'holds nothing that changes it'),
    ('“Change this bed’s size…” is back beside the link', 'js/panels.js', "onclick: () => root.LRFMapEdit.open({ bedId: bed.id }) }, 'Edit the layout…')));", "onclick: () => root.LRFMapEdit.open({ bedId: bed.id }) }, 'Edit the layout…'), h('button.link', { type: 'button', id: 'bedSizeEdit' }, 'Change this bed’s size…')));", 'holds nothing that changes it'),
    ('the link opens the mode with nothing picked', 'js/panels.js', "onclick: () => root.LRFMapEdit.open({ bedId: bed.id }) }, 'Edit the layout…')));", "onclick: () => root.LRFMapEdit.open({}) }, 'Edit the layout…')));", 'opens the mode with that bed picked'),
    ('the header’s counts open their lists behind the layout', 'js/mapedit.js', "count.addEventListener('click', () => { if (S.on) close(); }, true);", "count.addEventListener('click', () => {}, true);", 'count to settle leaves the layout'),
    ('only the count to settle leaves the layout', 'js/mapedit.js', "for (const id of ['waitBadge', 'settleBadge']) { const count = $(id);", "for (const id of ['settleBadge']) { const count = $(id);", 'count to place leaves the layout'),
    ('another view leaves the mode on', 'js/mapedit.js', "App.on('view', () => { if (S.on && App.state.view !== 'map') close(); });", "", 'another view ends the editing'),
]


def run_node():
    work = os.path.join(scratch, 'mut-node'); shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
    src = open(os.path.join(app, 'js', 'mapgeo.js'), encoding='utf-8').read()
    caught = missed = 0
    for name, find, repl, want in NODE:
        if words and not any(w in name.lower() for w in words): continue
        if src.count(find) != 1:
            print('NOT APPLIED', name, src.count(find)); missed += 1; continue
        open(os.path.join(work, 'mapgeo.js'), 'w', encoding='utf-8').write(src.replace(find, repl))
        out = subprocess.run(['node', os.path.join(tests, 'mapgeo_test.cjs'), work], capture_output=True, text=True).stdout
        try:
            failed = [f['name'] for f in json.loads(out[out.rfind('{"passed"'):])['failed']]
        except Exception:
            failed = ['(the test did not report)']
        hit = [f for f in failed if want in f]
        if hit: caught += 1; print('caught ', name, '→', hit[0][:90])
        else: missed += 1; print('MISSED ', name, '| failed instead:', failed[:3])
    print(json.dumps({'faults': caught + missed, 'caught': caught, 'missed': missed}))


def run_page():
    lo, hi = int(os.environ.get('FROM', 0)), int(os.environ.get('TO', len(PAGE)))
    caught = missed = 0
    for name, file, find, repl, want in PAGE[lo:hi]:
        if words and not any(w in name.lower() for w in words): continue
        work = os.path.join(scratch, 'mut-page'); shutil.rmtree(work, ignore_errors=True)
        shutil.copytree(app, work, ignore=shutil.ignore_patterns('data'))
        os.symlink(os.path.join(app, 'data'), os.path.join(work, 'data'))
        path = os.path.join(work, file); src = open(path, encoding='utf-8').read()
        if src.count(find) != 1:
            print('NOT APPLIED', name, src.count(find)); missed += 1; sys.stdout.flush(); continue
        open(path, 'w', encoding='utf-8').write(src.replace(find, repl))
        out = subprocess.run(['python3', '-I', os.path.join(tests, 'map_check.py'), work, os.path.join(scratch, 'mut-shots')], capture_output=True, text=True).stdout
        subprocess.run(['pkill', '-f', 'google-chrome'], capture_output=True)
        try:
            failed = json.loads(out[out.rfind('{"passed"'):])['failed']
        except Exception:
            failed = ['(the check did not report)']
        hit = [f for f in failed if want in f]
        if hit: caught += 1; print('caught ', name, '→', hit[0][:100])
        else: missed += 1; print('MISSED ', name, '| failed instead:', [f[:80] for f in failed[:3]])
        sys.stdout.flush()
    print(json.dumps({'faults': caught + missed, 'caught': caught, 'missed': missed}))


run_node() if mode == 'node' else run_page()
