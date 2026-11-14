"""Deliberate faults in step 3b (0.23), one at a time. Each must be caught by a named line.
usage: python3 -I mutate3b.py <app-dir> <scratch-dir> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
  node  faults in the engine, the forecast, the audit, the order sheet and the plan file, against step3b_test.cjs (a few seconds each)
  page  faults in the page, against step3b_check.py (one to three minutes each: it stops at the first line that fails)
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
 ('a crop line’s unit is ignored', 'js/engine.js', "String((v && v.cropId === c.id && sellVRule(v.id).unit) || sellRule(c.id).unit || recordUnit(c));", "String((v && v.cropId === c.id && sellVRule(v.id).unit) || recordUnit(c));"),
 ('a variety’s own unit is ignored', 'js/engine.js', "String((v && v.cropId === c.id && sellVRule(v.id).unit) || sellRule(c.id).unit || recordUnit(c));", "String(sellRule(c.id).unit || recordUnit(c));"),
 ('the crop’s price beats the variety’s', 'js/engine.js', "return mine != null ? mine : crops != null ? crops : nonNegative(c.price);", "return crops != null ? crops : mine != null ? mine : nonNegative(c.price);"),
 ('the list’s price beats a planting’s own', 'js/engine.js', "      if (p && p.price != null && p.price !== '') return nonNegative(p.price);\n", ""),
 ('the arithmetic with multipliers listens to the crop lines', 'js/engine.js', "const x = (!legacy && S.assumptions && S.assumptions.sell && S.assumptions.sell[cropId]) || {}, share", "const x = (S.assumptions && S.assumptions.sell && S.assumptions.sell[cropId]) || {}, share"),
 ('a sold share over a hundred is used', 'js/engine.js', "share: share != null && share <= 100 ? share : null,", "share,"),
 ('an unknown pattern is used', 'js/engine.js', "pattern: PATTERNS.includes(x.pattern) ? x.pattern : null,", "pattern: x.pattern || null,"),
 ('the list’s harvest days override a planting’s own', 'js/engine.js', "if (days == null || ownHarvest(p)) return e;", "if (days == null) return e;"),
 ('the list’s harvest days are ignored', 'js/engine.js', "return { ...e, hw: days, harvestMode: 'window', harvestBy: 'list',", "return { ...e, harvestBy: 'list',"),
 ('the crop’s turnover overrides a planting’s own', 'js/engine.js', "      if (p && p.turnover != null) return Math.max(0, Math.round(finite(p.turnover, turnoverDays())));\n", ""),
 ('the crop’s turnover is ignored', 'js/engine.js', "return mine != null ? mine : turnoverDays();", "return turnoverDays();"),
 ('a yield on the list is ignored', 'js/engine.js', "nonNegative(own ? p.yield : mine != null ? mine : c.yield);", "nonNegative(own ? p.yield : c.yield);"),
 ('a variety’s yield on the list is ignored', 'js/engine.js', "const fromV = !own && v && env ? listedYield('varieties', v.id, env) : null,", "const fromV = null,"),
 ('a yield for one growing condition is used in all of them', 'js/engine.js', "x = a && a[kind] && a[kind][id] && a[kind][id][env]; return x ? amount0(x.yield) : null; };", "x = a && a[kind] && a[kind][id] && Object.values(a[kind][id])[0]; return x ? amount0(x.yield) : null; };"),
 ('the sold share on a crop’s line is ignored', 'js/engine.js', "rule.share != null ? rule.share / 100 : clamp(finite(c.mk, 0.9), 0, 1), part", "clamp(finite(c.mk, 0.9), 0, 1), part"),
 ('a weekly figure is treated as a total', 'js/engine.js', "weekly = pattern === 'weekly' && !own, nominal", "weekly = false, nominal"),
 ('a planting’s own yield is read as a week’s picking', 'js/engine.js', "weekly = pattern === 'weekly' && !own, nominal", "weekly = pattern === 'weekly', nominal"),
 ('picked each week, a longer harvest gives no more', 'js/engine.js', "each = weekly ? perWeek * r.harvestDays / 7 : figure;", "each = weekly ? perWeek * nominal / 7 : figure;"),
 ('a live tray takes its crop’s keeping', 'js/engine.js', "keep: liveTray ? 0 : rule.keep || 0 };", "keep: rule.keep || 0 };"),
 ('the list does not show a weekly figure by the week', 'js/engine.js', "total0 == null ? null : weekly ? total0 * 7 / nominal : total0, value", "total0 == null ? null : total0, value"),
 ('“1 each” is not told apart from a real yield', 'js/engine.js', "(total0 == null || (total0 === 1 && unit0 === 'each'))", "(total0 == null)"),
 ('the list’s own harvest days are not what a total is spoken of over', 'js/engine.js', "nominal = rule.days || nominalDays(c), pattern = micro", "nominal = nominalDays(c), pattern = micro"),
 ('all at once is spread over the harvest days', 'js/forecast.js', "const lots = y.pattern === 'once' ? [[lo, y.units]] : picked.map(i => [i, rate]);", "const lots = picked.map(i => [i, rate]);"),
 ('keeping is ignored', 'js/forecast.js', "const keep = Math.max(1, Math.round((y.keep || 0) * 7)), lo", "const keep = 1, lo"),
 ('what keeps is counted in full every day it keeps', 'js/forecast.js', "for (let k = 0; k < keep; k++) avail[i - lo + k] += q / keep;", "for (let k = 0; k < keep; k++) avail[i - lo + k] += q;"),
 ('“picked” reads what there is to sell', 'js/forecast.js', "const series = picked ? x.out : x.avail;", "const series = x.avail;"),
 ('a tower cycle’s harvest day is offered', 'js/audit.js', "['window', open.filter(p => ownWindow(p) && !cycle(p)), windowOf,", "['window', open.filter(p => ownWindow(p)), windowOf,"),
 ('recorded work is offered', 'js/audit.js', "const live = plan.plantings.filter(p => !trayBatch(p)), open = live.filter(p => !recorded(p)), out = [];", "const live = plan.plantings.filter(p => !trayBatch(p)), open = live, out = [];"),
 ('a figure goes on a crop’s line though another planting of the crop would change', 'js/audit.js', "c.ok = mine && plan.plantings.filter(p => p.cropId === cropId && !ids.has(p.id)).every(p => alike(figure(eng, p), figure(sim, sim.planting(p.id))));", "c.ok = mine;"),
 ('a line that already holds the grower’s figure is written over', 'js/audit.js', "const taken = (level, id, env) => kind === 'yield' ? lineOf(level, id, env) != null && lineOf(level, id, env) !== '' : ((a0.sell || {})[id] || {})[kind === 'window' ? 'days' : 'turnover'] != null;", "const taken = () => false;"),
 ('“keep” is not kept', 'js/audit.js', "if (choice === 'keep') { if (later) r.ids.forEach(id => stays.add(id)); else kept += r.ids.length; continue; }", "if (choice === 'keep' && !later) { kept += r.ids.length; continue; }"),
 ('letting one copied value go throws away the whole copy', 'js/audit.js', "    for (const k of fields) delete crop[k];\n", "    for (const k of Object.keys(crop)) delete crop[k];\n"),
 ('a bulb is offered as a copy to let go', 'js/audit.js', "const COPY = ['yield', 'price', 'mk',", "const COPY = ['material', 'plantingMaterial', 'yield', 'price', 'mk',"),
 ('the preview misses yields that change', 'js/audit.js', "if (Math.abs(a.units - b.units) > 1e-6 || a.unit !== b.unit || Math.abs(a.price - b.price) > 1e-9) yields.push(", "if (false) yields.push("),
 ('double bookings a step settles are not counted', 'js/audit.js', "settled = [...old].filter(k => !after.has(k)).map(k => k.split('|'));", "settled = [];"),
 ('the suggestion lets go a group whose yield would change', 'js/audit.js', "r.varieties = [...new Set(r.varieties.values())].filter(Boolean); r.choice = r.agrees ? 'follow' : r.take ? 'take' : 'keep'; out.push(r); }", "r.varieties = [...new Set(r.varieties.values())].filter(Boolean); r.choice = r.agrees || !r.take ? 'follow' : 'take'; out.push(r); }"),
 ('a yield the list takes wipes the days in its cell', 'js/audit.js', "record[take.env] = { ...(record[take.env] || {}), yield: take.typed };", "record[take.env] = { yield: take.typed };"),
 ('days the list takes wipe the yield in their cell', 'js/audit.js', "[env]: { ...((assumptions[kind][id] || {})[env] || {}), dtm: Math.round(days) } };", "[env]: { dtm: Math.round(days) } };"),
 ('a planting is counted once for every figure let go', 'js/audit.js', "plantings: after.size + let_go.size };", "plantings: rows.filter(r => pick(r) !== 'keep').reduce((n, r) => n + r.ids.length, 0) };"),
 ('a copy that matters is suggested to be let go', 'js/audit.js', "r.choice = r.agrees ? 'follow' : 'keep'; out.push(r);\n    }\n    const same", "r.choice = 'follow'; out.push(r);\n    }\n    const same"),
 ('two spellings of a supplier are two groups', 'js/seedlib.js', "key = name ? supplierKey(name) || norm(name) : '';", "key = name;"),
 ('a variety that is not short is on the sheet', 'js/seedlib.js', "      if (!(amount > 0)) continue;\n      if (!r.variety) { loose", "      if (amount < 0) continue;\n      if (!r.variety) { loose"),
 ('an amount typed on a line is ignored', 'js/seedlib.js', "amount = set ? +asked : r.short;", "amount = r.short;"),
 ('the total leaves suppliers out', 'js/seedlib.js', "cost: list.reduce((n, g) => n + g.cost, 0),", "cost: list.length ? list[0].cost : 0,"),
 ('plantings with no variety chosen vanish from the sheet', 'js/seedlib.js', "if (!r.variety) { loose.push({ key: r.key, row: r, crop: r.crop, unit: r.unit, amount }); continue; }", "if (!r.variety) continue;"),
 ('a list holding only a price is dropped when a newer backup is loaded', 'js/planio.js', " + Object.keys(a.sell || {}).length + Object.keys(a.sellV || {}).length : 0;", " : 0;"),
]
PAGE = [
 ('the buttons under the heading do nothing', 'js/assume.js', "button.addEventListener('click', () => { ui.mode = button.dataset.asMode; render(); });", "button.addEventListener('click', () => { render(); });"),
 ('a placeholder yield is not marked', 'js/assume.js', "loose ? h('small.as-guess', { title: 'This yield is the starting value", "false ? h('small.as-guess', { title: 'This yield is the starting value"),
 ('a price typed is written to nothing', 'js/assume.js', "save: n => App.setSell(c.id, { price: n }, n == null ?", "save: n => App.setSell(c.id, {}, n == null ?"),
 ('the toast does not say what happens to the season’s worth', 'js/app.js', "const also = [worth, settles].filter(Boolean).join(' · ');", "const also = '';"),
 ('a yield typed for one growing condition is saved for another', 'js/assume.js', "save: n => App.setYield(kind, id, env, n, n == null ?", "save: n => App.setYield(kind, id, eng.ENVS.find(x => x !== env), n, n == null ?"),
 ('switching to a weekly figure leaves the typed yields as they were', 'js/app.js', "if (before && 'pattern' in change && weekly !== before.weekly) {", "if (false) {"),
 ('clearing a cell leaves a nought behind', 'js/app.js', "value == null || value === '' || !(+value >= 0) ? null : figure3(+value)));", "figure3(+value || 0)));"),
 ('Tab from a cell loses the place', 'js/assume.js', "focus.vstart ? ['vstart', focus.vstart] : focus.hk ? ['hk', focus.hk] : null);", "focus.vstart ? ['vstart', focus.vstart] : null);"),
 ('turnover does not say what it settles', 'js/app.js', "const settles = hit.settled ? `", "const settles = false ? `"),
 ('a variety’s price is saved on its crop', 'js/assume.js', "save: n => App.setSellV(v.id, { price: n },", "save: n => App.setSell(c.id, { price: n },"),
 ('the Harvest view never offers “Picked”', 'js/harvestview.js', "m.keeps ? h('div.seg.hv-series'", "false ? h('div.seg.hv-series'"),
 ('“Picked” shows the same figures as “To sell”', 'js/harvestview.js', "const seriesOf = (m, x) => (series === 'picked' && m.keeps ? x.picked : x.days);", "const seriesOf = (m, x) => x.days;"),
 ('the summary does not count own yields', 'js/assume.js', "fig('own yield', hv.yield,", "fig('own yield', 0,"),
 ('the review window has no yield section', 'js/assume.js', "    section('Yield', 'yield',", "    if (false) section('Yield', 'yield',"),
 ('the review does not say what using the list’s yield does', 'js/assume.js', "if (Math.abs(a - b) > 1e-6) out.push(`yield ${num(a)} → ${num(b)}", "if (false) out.push(`yield ${num(a)} → ${num(b)}"),
 ('the season’s worth is not shown changing', 'js/assume.js', "h('b', worthMoved ? `${money(view.worth[0])} → ${money(view.worth[1])}` : money(view.worth[0]))", "h('b', money(view.worth[0]))"),
 ('Apply takes no snapshot', 'js/app.js', "    await snapshot('Before plantings followed the list');\n", ""),
 ('Escape leaves the order sheet open', 'js/seeds.js', "{ id: 'orderDlg', oncancel: e => { e.preventDefault(); close(); } },", "{ id: 'orderDlg', oncancel: e => { e.preventDefault(); } },"),
 ('an amount typed on the sheet is ignored', 'js/seeds.js', "else amounts[l.key] = +raw; draw(); }", "else amounts[l.key + 'x'] = +raw; draw(); }"),
 ('a variety cannot be added to the sheet', 'js/seeds.js', "added.add(pick.value); amounts[r.key] = n; draw(); };", "draw(); };"),
 ('marking as ordered puts nothing on order', 'js/seeds.js', "status: 'ordered', supplier: g.key ? g.name : '', year }, ctx), lib));", "status: 'excluded', supplier: g.key ? g.name : '', year }, ctx), lib));"),
 ('the sheet does not say that doubly booked ground is counted twice', 'js/seeds.js', "const notes = [pairs ? `Seed for both plantings is counted", "const notes = [false ? `Seed for both plantings is counted"),
]
if mode == 'list': print(json.dumps({'node': len(NODE), 'page': len(PAGE)})); sys.exit(0)
faults = [f for f in (NODE if mode == 'node' else PAGE) if not only or any(w in f[0] for w in only)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
work = os.path.join(scratch, 'mutant')
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
caught, missed, broken = [], [], []
for name, rel, find, repl in ([(None, None, None, None)] if faults else []) + faults:
    if os.path.exists(work):
        shutil.rmtree(work)
    shutil.copytree(app, work)
    if name is not None:
        path = os.path.join(work, rel)
        text = open(path, encoding='utf-8').read()
        if text.count(find) != 1:
            print('BROKEN (the text to change is there %d times): %s' % (text.count(find), name), flush=True); broken.append(name); continue
        open(path, 'w', encoding='utf-8').write(text.replace(find, repl))
    if mode == 'node':
        out = subprocess.run(['node', os.path.join(tests, 'step3b_test.cjs'), work, plan], capture_output=True, text=True, timeout=300).stdout
    else:
        out, err = alone([sys.executable, '-I', os.path.join(tests, 'step3b_check.py'), work, os.path.join(scratch, 'mutant-shots')], 600, env=dict(os.environ, STOP_AT_FAIL='1'))
    try: fails = [str(x) for x in json.loads(out[out.rindex('{"passed"'):].strip())['failed']]; ran = True   # the names of the lines that failed, as the check's last line gives them
    except Exception: fails = []; ran = False
    fails = [l for l in fails if 'stopped before its end' not in l]   # a check that only stops has named no line: that is not a catch
    if name is None: already = unfaulted(fails, ran); continue
    n = len(fails); fails = [l for l in fails if already is not None and l not in already]
    if fails:
        caught.append(name); print('caught  %s  <-  %s' % (name, fails[0][:150]), flush=True)
    else:
        missed.append(name); print('MISSED  %s%s' % (name, '  (only what fails with no fault in it too)' if n else '' if ran else '  (the check gave no result)'), flush=True)
print(json.dumps({'mode': mode, 'faults': len(faults), 'caught': len(caught), 'missed': missed, 'broken': broken}))
