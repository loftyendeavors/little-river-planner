"""Deliberate faults for step 5b: each is put into a copy of the app, and a named check must fail.
usage: python3 -I mutate5b.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: every fault against step5b_test.cjs (a minute or two; give OLD=<dir of the previous js> so a fault that moves a figure by itself is caught). page: faults against step5b_check.py (a few minutes each). list: how many faults there are of each kind, and nothing else.
Four faults were taken out when the checks moved into the repository: the code each one changed is gone, by design
(plug trays are counted over the season, and the benches are edited on a page of their own, not in a window).
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
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
 ("an unheated bench is counted under heat", "js/engine.js", "const benchKind = sp => sp.kind === 'outside' ? 'outside' : !legacy && sp.kind === 'unheated' ? 'unheated' : 'heated';", "const benchKind = sp => sp.kind === 'outside' ? 'outside' : 'heated';"),
 ("a typed tray count is ignored", "js/engine.js", "const benchCap = sp => { const mine = benchHolds(sp); return mine == null ? benchEstimate(sp) : mine; };", "const benchCap = sp => benchEstimate(sp);"),
 ("the mode with multipliers reads a typed count", "js/engine.js", "const benchHolds = sp => !legacy && sp.holds != null", "const benchHolds = sp => sp.holds != null"),
 ("a bench out of use still holds trays", "js/engine.js", "    function benchOpen(sp, date) {\n      if (sp.active === false) return false;", "    function benchOpen(sp, date) {\n      if (false) return false;"),
 ("a bench outside is there all winter", "js/engine.js", "return from && to && from > to ? (md >= from || md <= to) : (!from || md >= from) && (!to || md <= to);", "return true;"),
 ('hardening off stays under heat though there is room outside', 'js/engine.js', 'out = Math.min(row.harden - un, room.outside), part', 'out = 0, part'),
 ('the bench outside takes more than it holds', 'js/engine.js', 'out = Math.min(row.harden - un, room.outside), part', 'out = row.harden - un, part'),
 ('the unheated benches are passed over', 'js/engine.js', 'un = Math.min(row.harden, Math.max(0, room.unheated - row.cool)), out', 'un = 0, out'),
 ('what goes outside is not taken off the heat', 'js/engine.js', 'heated: pool(legacy ? row.cap : room.heated, row.total - row.cool - un - out, k => row[k] - cool[k] - hard[k] * part(un + out)),', 'heated: pool(legacy ? row.cap : room.heated, row.total - row.cool, k => row[k] - cool[k]),'),
 ('hardening off goes outside before the unheated benches', 'js/engine.js', 'un = Math.min(row.harden, Math.max(0, room.unheated - row.cool)), out = Math.min(row.harden - un, room.outside), part', 'out = Math.min(row.harden, room.outside), un = Math.min(row.harden - out, Math.max(0, room.unheated - row.cool)), part'),
 ('hardening off takes room the grown-on crop already holds', 'js/engine.js', 'un = Math.min(row.harden, Math.max(0, room.unheated - row.cool)), out', 'un = Math.min(row.harden, room.unheated), out'),
 ('a crop grown on without heat is never moved', 'js/engine.js', 'else if (byRule) { cool[u.kind] += u.eq; row.cool += u.eq; }', 'else if (false) { cool[u.kind] += u.eq; row.cool += u.eq; }'),
 ('a crop grown on leaves the heat the day it is sown', 'js/engine.js', ' && date >= addDays(r.sow, Math.max(0, Math.round(finite(rule.after, 0))));', ';'),
 ('a crop grown on is on the unheated benches all year', 'js/engine.js', 'return !!rule && inSpan(date, rule.from, rule.to) &&', 'return !!rule &&'),
 ('every crop is grown on once one is', 'js/engine.js', 'const rule = coolRules().find(x => x.cropId === r.planting.cropId);', 'const rule = coolRules()[0];'),
 ('what hardens off is also counted as grown on', 'js/engine.js', "const byRule = !hardening && it.kind === 'prop' && coolOn(it.r, date);", "const byRule = it.kind === 'prop' && coolOn(it.r, date);"),
 ("the mode with multipliers reads the grown-on list", 'js/engine.js', 'const coolRules = () => (!legacy && Array.isArray(S.nursery && S.nursery.cool) ?', 'const coolRules = () => (Array.isArray(S.nursery && S.nursery.cool) ?'),
 ('a crop grown on is still counted under heat', 'js/engine.js', 'row.total - row.cool - un - out, k => row[k] - cool[k] - hard[k] * part(un + out)),', 'row.total - un - out, k => row[k] - hard[k] * part(un + out)),'),
 ("tower seedlings harden off", "js/engine.js", "const hs = it.kind === 'prop' ? hardenStart(it.r) : null, hardening = !!hs && date >= hs;", "const hs = it.kind === 'prop' ? (hardenStart(it.r) || addDays(it.r.field, -7)) : null, hardening = !!hs && date >= hs;"),
 ("seedlings harden from the day they are sown", "js/engine.js", "hardening = !!hs && date >= hs;", "hardening = !!hs;"),
 ("a recorded hardening day does not move the load", "js/engine.js", "const planned = hardenPlanned(r), actual = planned ? doneOf(r.planting, 'harden') : null;", "const planned = hardenPlanned(r), actual = null;"),
 ("being over is measured against every load, not what stands under heat", "js/engine.js", "row.over = legacy ? Math.max(0, row.total - row.cap) : row.pools.heated.over;", "row.over = Math.max(0, row.total - 1);"),
 ('a live tray is sown in cells by guess', 'js/engine.js', "set = cells > 0 && perCell > 0; return { how: 'cells', cells, perCell, set, seeds: set ? cells * perCell : 0, said: !!x }; }", "set = cells > 0; return { how: 'cells', cells, perCell, set, seeds: cells * (perCell || 10), said: !!x }; }"),
 ('a tray crop with a weight is taken as sown in cells', 'js/engine.js', "x.how : legacy || grams > 0 || !(c && c.micro) ? 'open' : 'cells';", "x.how : legacy || !(c && c.micro) ? 'open' : 'cells';"),
 ('a crop he said is broadcast goes back to cells', 'js/engine.js', "const how = x && (x.how === 'cells' || x.how === 'open') ? x.how :", "const how = x && x.how === 'cells' ? x.how :"),
 ('a tray crop he has said nothing about is weighed', 'js/engine.js', "x.how : legacy || grams > 0 || !(c && c.micro) ? 'open' : 'cells';", "x.how : 'open';"),
 ("a tray sown in cells is still weighed", "js/engine.js", "seeds = Math.ceil(len * live.seeds - 1e-9); seedG = 0; }", "seeds = Math.ceil(len * live.seeds - 1e-9); seedG = len * (c.seedG || 0); }"),
 ("the mode with multipliers counts cells", 'js/engine.js', "const x = !legacy && c && c.micro && c.liveSow && typeof c.liveSow === 'object' ? c.liveSow : null, grams", "const x = c && c.micro && c.liveSow && typeof c.liveSow === 'object' ? c.liveSow : null, grams"),
 ("seeds required still weighs a tray sown in cells", "js/seedlib.js", "      const unit = r.rack ? liveUnit(engine, c) : material === 'seed' ? 'seeds' : material + 's';\n      const key", "      const unit = r.rack ? 'g' : material === 'seed' ? 'seeds' : material + 's';\n      const key"),
 ("a sowing in cells is recorded by weight", "js/seedlib.js", "    const unit = r.rack ? liveUnit(engine, c) : material === 'seed' ? 'seeds' : material + 's', stock = stockUnit(unit);", "    const unit = r.rack ? 'g' : material === 'seed' ? 'seeds' : material + 's', stock = stockUnit(unit);"),
 ("the tray list forgets seeds", "js/trays.js", "row.seedG += b.seedG; row.seeds += b.seeds;", "row.seedG += b.seedG;"),
 ("a new bench is not like the last", "js/nursery.js", "w: like ? like.w : 3, l: like ? like.l : 6,", "w: 3, l: 6,"),
 ("two benches get the same name", "js/nursery.js", "for (let i = spacesOf(n).length + 1; ; i++) if (!used.has('bench ' + i)) return 'Bench ' + i;", "return 'Bench ' + spacesOf(n).length;"),
 ("an edit changes the record handed in", "js/nursery.js", "const open = nursery => { const n = nursery && typeof nursery === 'object' ? clone(nursery) : blank();", "const open = nursery => { const n = nursery && typeof nursery === 'object' ? nursery : blank();"),
 ("an unknown kind of bench is taken", "js/nursery.js", "if (!KIND_IDS.includes(change.kind)) throw Error('A bench is under heat, under cover without heat, or outside.');", ""),
 ("part of a tray is taken as a count", "js/nursery.js", "if (!Number.isInteger(h) || h < 0 || h > 5000) throw", "if (h < 0 || h > 5000) throw"),
 ("clearing a count leaves a zero", "js/nursery.js", "if (change.holds == null || String(change.holds).trim() === '') delete sp.holds;", "if (change.holds == null || String(change.holds).trim() === '') sp.holds = 0;"),
 ("a bench moves two places", "js/nursery.js", "to = at + (by < 0 ? -1 : 1);", "to = at + (by < 0 ? -2 : 2);"),
 ("a house is added twice", "js/nursery.js", "if (have) return { nursery: n, id: have.id };", ""),
 ("a share of twenty per cent is taken", "js/nursery.js", "if (!Number.isFinite(p) || p < 30 || p > 100) throw", "if (!Number.isFinite(p) || p < 3 || p > 100) throw"),
 ("the days of hardening off may be a fraction", "js/nursery.js", "if (!Number.isInteger(d) || d < 0 || d > 21) throw", "if (d < 0 || d > 21) throw"),
 ("the fullest day of a kind of bench is the first day", "js/nursery.js", "if (!was || p.used - p.cap > was.used - was.cap || (p.used - p.cap === was.used - was.cap && p.used > was.used)) week.pools[k]", "if (!was) week.pools[k]"),
 ('hardening left under cover forgets the unheated benches', 'js/nursery.js', 'const inside = row.hardenIn;', 'const inside = row.harden - row.pools.outside.used;'),
 ('live trays in cells are still counted as open trays', 'js/nursery.js', "if (how.how === 'cells' && how.cells > 0) liveCells.set(how.cells, (liveCells.get(how.cells) || 0) + it.n); else if (how.how === 'cells') liveUnsaid += it.n; else liveOpen += it.n;", 'liveOpen += it.n;'),
 ('a tray whose cells are not said is counted as an open tray', 'js/nursery.js', "else if (how.how === 'cells') liveUnsaid += it.n; else liveOpen += it.n;", 'else liveOpen += it.n;'),
 ('a day that is not a day is taken for the grown-on list', 'js/nursery.js', 'if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > new Date(2028, +m[1], 0).getDate()) throw', 'if (!m) throw'),
 ('the year is kept with the day', 'js/nursery.js', 'return `${m[1]}-${m[2]}`; };', 'return text; };'),
 ('an emptied grown-on list is kept as a list', 'js/nursery.js', '    if (list.length) n.cool = list; else delete n.cool;', '    n.cool = list;'),
 ('a second line is added for the same crop', 'js/nursery.js', 'if (at >= 0) list[at] = rule; else list.push(rule);', 'list.push(rule);'),
 ('the most grown on is never found', 'js/nursery.js', 'if (row.cool > cool.most) { cool.most = row.cool; cool.on = new Date(date); }', ''),
 ("rockwool is counted a planting at a time", "js/nursery.js", "const tray = plan && plan.tray, key = plan && plan.trayGroup ? plan.trayGroup : plan && plan.batchId ? plan.batchId : it.p.id;\n      const cells", "const tray = plan && plan.tray, key = it.p.id;\n      const cells"),
 ("the shelf is not taken off", "js/nursery.js", "const h = Number(have[id]) > 0 ? Math.floor(Number(have[id])) : 0, buy = Math.max(0, need - h);", "const h = Number(have[id]) > 0 ? Math.floor(Number(have[id])) : 0, buy = need;"),
 ("to buy goes below nothing", "js/nursery.js", "const h = Number(have[id]) > 0 ? Math.floor(Number(have[id])) : 0, buy = Math.max(0, need - h);", "const h = Number(have[id]) > 0 ? Math.floor(Number(have[id])) : 0, buy = need - h;"),
 ("mix is guessed for a tray with no figure", "js/nursery.js", "MIX_EACH[id] != null ? MIX_EACH[id] : null, each =", "MIX_EACH[id] != null ? MIX_EACH[id] : 3, each ="),
 ("a cubic foot is thirty quarts", "js/nursery.js", "const DRY_QT_PER_CUFT = 1728 / 67.200625;", "const DRY_QT_PER_CUFT = 1728 / 57.75;"),
 ("other years' plantings are counted in supplies", "js/nursery.js", "      if (String(it.p.date).slice(0, 4) !== text) continue;\n", ""),
 ("a cleared figure is kept as nothing", "js/nursery.js", "delete next[group][key]; if (!Object.keys(next[group]).length) delete next[group]; };", "delete next[group][key]; };"),
 ("part of a tray on the shelf is taken", "js/nursery.js", "(!bags && !Number.isInteger(n)))) throw", "false)) throw"),
 ("benches changed here are lost to an older backup", "js/planio.js", "if (prev.nursery && prev.nursery.lrfEdited === true) { plan.nursery = prev.nursery; notes.push('your benches'); }", ""),
 ("every plan's benches are carried, touched or not", "js/planio.js", "if (prev.nursery && prev.nursery.lrfEdited === true) {", "if (prev.nursery) {"),
 ("the shelf is lost to an older backup", "js/planio.js", "for (const key of ['crates', 'trayStart', 'trays', 'groups', 'supplies']) if (mine[key]) keep[key] = mine[key];", "for (const key of ['crates', 'trayStart', 'trays', 'groups']) if (mine[key]) keep[key] = mine[key];"),
 ("a weighed lot turned into seeds keeps its grams", "js/seedlib.js", "    if (to.quantity !== undefined) after.quantity = amountOf(to.quantity, after.unit, 'Quantity');\n", ""),
 ("seeds per gram reads a pound as a gram", "js/seedlib.js", "v.seedsPerLb > 0 ? v.seedsPerLb / LB_G : null);", "v.seedsPerLb > 0 ? v.seedsPerLb : null);"),
 ("the heated room moved by itself", "js/engine.js", "const benchEstimate = sp => Math.floor(nonNegative(sp.w) * nonNegative(sp.l) * benchPacking() / TRAY_FT2);", "const benchEstimate = sp => Math.ceil(nonNegative(sp.w) * nonNegative(sp.l) * benchPacking() / TRAY_FT2);"),
]
PAGE = [
 ("a change to the benches says nothing of the room", "js/bench.js", "UI.toast(room ? `${label} · ${room}` : label, { label: 'Undo', run: App.undo });", "UI.toast(label, { label: 'Undo', run: App.undo });"),
 ("only the heated benches are drawn", "js/bench.js", "const charts = fig.weeks.length ? fig.shown.map(kind =>", "const charts = fig.weeks.length ? fig.shown.slice(0, 1).map(kind =>"),
 # Not a fault any more: "the Week view does not redraw the benches" (the page not listening for a change to the nursery). A change to the
 # benches is a step of the plan, and the Tasks page redraws on every step of the plan, so taking that listener out changes nothing there.
 ("the Seeds list is built whole on every change", "js/seeds.js", "      if (was && was.sig === sig && same(was)) { drawn.kept++; return was.nodes; }", ""),
 ("a row of the Seeds list is kept though its variety changed", "js/seeds.js", "was => was.v === v, () => rowOf(v, flat), { v });", "() => true, () => rowOf(v, flat), { v });"),
 ("supplies ignore the shelf on the page", "js/bench.js", "sup = N.supplies(eng, App.planYear(), (App.state.plan.lrfNext || {}).supplies || null, fig);", "sup = N.supplies(eng, App.planYear(), null, fig);"),
 ('how a tray is sown is not kept on the crop', 'js/app.js', '    after.liveSow = live;   // once he has touched it', "    if (live.how === 'cells') after.liveSow = live; else delete after.liveSow;   // once he has touched it"),
 ("the bench outside is never said to be full", "js/bench.js", "else if (t.cap - t.used < 0.05) { state = 'full';", "else if (false) { state = 'full';"),
 ("a bench edit is not marked as made here", "js/app.js", "const after = { ...changed, lrfEdited: true };", "const after = { ...changed };"),
 ("the Week view words a tray in cells by weight", "js/sowview.js", "how.how === 'cells' ? ` · ${num(how.cells)} cells, ${num(how.perCell, 1)} seed${how.perCell === 1 ? '' : 's'} a cell` : ", "false ? '' : "),
 ('adding a crop to the grown-on list says nothing of what it does', 'js/bench.js', "const room = [roomText(done), say ? say() : ''].filter(Boolean).join(' · ');", 'const room = roomText(done);'),
 ('tower crops are offered for the grown-on list', 'js/bench.js', "if (it.kind === 'prop' && !it.r.tw) raised.set(it.p.cropId, cropName(it.p.cropId));", "if (it.kind === 'prop') raised.set(it.p.cropId, cropName(it.p.cropId));"),
 ('a tray crop opens as an open tray on the page', 'js/app.js', '    live.how = state.engine.liveSow(state.engine.crop(cropId)).how;   // the way it is counted now, said or not', "    live.how = live.how || 'open';"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
copy = scratch / "mutant"; caught, missed, broken = [], [], []
for name, rel, old, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("thumbs.json", "farm-map.jpg", "dev")) if mode == "node" else shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(old) != 1: broken.append((name, f"the text to change is there {s.count(old)} times")); print(f"BROKEN {name} :: {broken[-1][1]}", flush=True); continue
        f.write_text(s.replace(old, new), encoding="utf-8")
    if mode == "node":
        out = subprocess.run(["node", str(tests / "step5b_test.cjs"), str(copy), str(plan)] + ([os.environ["OLD"]] if os.environ.get("OLD") else []), capture_output=True, text=True, timeout=300).stdout
    else:
        out = alone([sys.executable, "-I", str(tests / "step5b_check.py"), str(copy), str(scratch / "mutant-shots")], 1500, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
    try:
        d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else x for x in d["failed"]]
    except Exception: names = ["(the test did not finish: " + out[-200:].replace("\n", " ") + ")"]
    real = [n for n in names if n != "the test ran to its end" and not n.startswith("(the test did not finish")]
    if name is None: already = unfaulted(real, bool(real) or not names); continue
    real = [n for n in real if already is not None and n not in already]
    (caught if real else missed).append((name, (real or names)[:2]))
    print(("caught " if real else "MISSED ") + name + " :: " + "; ".join((real or names)[:2])[:230] + (" (which fails with no fault in it too)" if names and not real else ""), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": [m[0] for m in missed], "broken": [b[0] for b in broken]}))
