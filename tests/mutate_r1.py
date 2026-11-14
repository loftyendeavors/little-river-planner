"""Deliberate faults for preview 0.31 (R1, where things live): each is put into a copy, and a named check must fail.
usage: python3 -I mutate_r1.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against r1_check.py (up to a minute each). list: how many faults there are, and nothing else.
(The node mode ran r1_test.cjs, the proof of one past build. That proof is retired, tests/what_changed.cjs with tests/this-build.json does its work, and the mode is taken out.)
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests = [Path(x).resolve() for x in sys.argv[1:4]]
mode = sys.argv[4] if len(sys.argv) > 4 else "page"; words = [w.lower() for w in sys.argv[5:]]
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
BN, TV, SV, PN, HV, TL, SE, IX, CSS = "js/bench.js", "js/traysview.js", "js/sowview.js", "js/panels.js", "js/harvestview.js", "js/timeline.js", "js/seeds.js", "index.html", "css/app.css"
PAGE = [
 ("the view is still called Trays", IX, ">Nursery</button>", ">Trays</button>"),
 ("the rule before Assumptions is missing", IX, '<i class="views-sep" aria-hidden="true"></i>\n    <button type="button" data-view-btn="assume"', '<button type="button" data-view-btn="assume"'),
 ("Harvest has no tooltip", IX, ' title="What the plan gives, week by week">Harvest', '>Harvest'),
 ("the count to settle leaves out plantings longer than their bed", PN, "return todo.count ? longSets(todo).size + todo.groups.length : 0; }", "return todo.count ? todo.groups.length : 0; }"),
 ("the count to settle is in the colour of a warning", CSS, ".settle-badge { border: 1px solid var(--line); background: var(--raised);", ".settle-badge { border: 1px solid var(--line); background: var(--flag-soft);"),
 ("the count to settle is never drawn", PN, "App.on('plan', laterSettle); }", "}"),
 ("a click on the count stays in the view it was pressed in", PN, "    if (!['map', 'timeline'].includes(App.state.view)) App.setView('map');\n    cleanupOpen = true;", "    cleanupOpen = true;"),
 ("the list opens folded after its first three", PN, "    cleanupOpen = true; holdSettle = true;\n    if (App.state.sel) App.select(null); else render();", "    cleanupOpen = false; holdSettle = true;\n    if (App.state.sel) App.select(null); else render();"),
 ("the list slides out of sight when a box above it goes", PN, "if (!overview) holdSettle = false; else if (holdSettle) settleInView(host);", "if (!overview) holdSettle = false;"),
 ("the list is never held where the click put it", PN, "    cleanupOpen = true; holdSettle = true;\n", "    cleanupOpen = true;\n"),
 ("the list is still held after the panel is scrolled by hand", PN, "for (const kind of ['wheel', 'touchmove', 'keydown']) host.addEventListener(kind, () => { holdSettle = false; }, { passive: true });", ""),
 ("the count to settle shows on a phone", CSS, "body.phone #settleBadge { display: none !important; }", ""),
 ("the Nursery opens on Live trays", TV, "let tab = 'room', drawn = null;", "let tab = 'live', drawn = null;"),
 ("the Supplies tab is missing", TV, "    ['supplies', 'Supplies', 'What the season uses of trays, rockwool, pots and mix, less what is on the shelf.'],\n", ""),
 ("the tabs move down on Live trays", TV, "h('h2', { id: 'nuTitle' }, title)),", "h('h2', { id: 'nuTitle' }, title), tab === 'live' ? h('p', lead) : null),"),
 ("the week's tile shows the season's fullest day", TV, "heat && heat.used > 1e-9 ? (heat.cap ? `${num(heat.used, 0)} of ${num(heat.cap)}`", "heat && heat.used > 1e-9 ? (heat.cap ? `${num(t.used, 0)} of ${num(heat.cap)}`"),
 ("the nursery's count takes seed sown in the ground too", SV, "tray = sow.filter(l => l.kind !== 'direct').length, direct = sow.length - tray;", "tray = sow.length, direct = sow.length - tray;"),
 ("the nursery's count keeps what is already recorded", SV, "const sow = figures().list.filter(l => l.week === week && l.state !== 'done'), other =", "const sow = figures().list.filter(l => l.week === week), other ="),
 ("the nursery tile's button opens all of Tasks", TV, "id: 'nuToTasks', title: 'The week’s list, with only the nursery’s tasks', onclick: () => { if (root.LRFSowView && root.LRFSowView.open) root.LRFSowView.open('nursery'); } }", "id: 'nuToTasks', title: 'The week’s list, with only the nursery’s tasks', onclick: () => { if (root.LRFSowView && root.LRFSowView.open) root.LRFSowView.open('all'); } }"),
 ("the bench room stands between the demand and its weeks again", TV, "    weekSection(fig)];\n  }", "    Bench.room(), weekSection(fig)];\n  }"),
 ("Set-up leaves out hardening off and growing on", BN, "poolLines(fig), benchesBox(fig), rulesBox(fig), countBox(fig)));", "poolLines(fig), benchesBox(fig), countBox(fig)));"),
 ("Set-up has no line of the room above the benches", BN, "h('div.bn-head', h('h3', 'The room these give')),\n      poolLines(fig), benchesBox(fig)", "h('div.bn-head', h('h3', 'The room these give')),\n      benchesBox(fig)"),
 ("the benches are shut behind a button again", BN, "      poolLines(fig), benchesBox(fig), rulesBox(fig), countBox(fig)));", "      poolLines(fig), h('button.btn.small', { type: 'button', id: 'bnEdit' }, 'Benches…'), rulesBox(fig), countBox(fig)));"),
 ("the way to the benches is across the page again", CSS, ".bn-head .btn { margin-left: 0; }", ".bn-head .btn { margin-left: auto; }"),
 ("“Edit benches and rules” goes nowhere", BN, "const toSetup = () => { if (root.LRFTraysView) root.LRFTraysView.open('setup'); };", "const toSetup = () => {};"),
 ("the old way to open the benches is dead", BN, "openEditor(on = true) { if (root.LRFTraysView) root.LRFTraysView.open(on ? 'setup' : 'room'); } };", "openEditor() {} };"),
 ("the Nursery is remembered on the tab it was left on", TV, "  let tab = 'room', drawn = null;", "  let tab = (() => { try { return root.sessionStorage.getItem('nu') || 'room'; } catch (_) { return 'room'; } })(), drawn = null; setInterval(() => { try { root.sessionStorage.setItem('nu', tab); } catch (_) {} }, 200);"),
 ("seed sown in the ground is listed with the nursery as well", SV, "['plugs', 'rockwool', 'live'], ['potup', 'harden']],", "['plugs', 'rockwool', 'live', 'direct'], ['potup', 'harden']],"),
 ("hardening off is left out of the nursery", SV, "['plugs', 'rockwool', 'live'], ['potup', 'harden']],", "['plugs', 'rockwool', 'live'], ['potup']],"),
 ("planting out is listed with the nursery", SV, "['plugs', 'rockwool', 'live'], ['potup', 'harden']],\n    ['field', 'Field', 'Planting, wherever the plant goes: beds, tunnels, greenhouses, towers and crates. And seed sown in the ground.', ['direct'], ['plant', 'move']]", "['plugs', 'rockwool', 'live'], ['potup', 'harden', 'plant']],\n    ['field', 'Field', 'Planting, wherever the plant goes: beds, tunnels, greenhouses, towers and crates. And seed sown in the ground.', ['direct'], ['move']]"),
 ("the scope leaves the other tasks unfiltered", SV, "ours = all.filter(l => inScope(l.section)), scoped = ui.scope !== 'all';", "ours = all, scoped = ui.scope !== 'all';"),
 ("the scope leaves the sowings unfiltered", SV, "const sown = fig.list.filter(l => inScope(l.kind)), ours = all.filter", "const sown = fig.list, ours = all.filter"),
 ("the earlier tasks are counted whole in each half", SV, "const week = sown.filter(inSpan), earlier = sown.filter(l => l.week < now && l.state !== 'done'), weekOpen", "const week = sown.filter(inSpan), earlier = fig.list.filter(l => l.week < now && l.state !== 'done'), weekOpen"),
 ("the season's count is the whole list in each half", SV, "seasonAll = sown.length + seasonJobs.length;", "seasonAll = fig.total + seasonJobs.length;"),
 ("the half is not remembered", SV, "root.localStorage.setItem(PREF_KEY, JSON.stringify({ scope: ui.scope, span: ui.span }));", "void 0;"),
 ("how far ahead is not remembered", SV, "onclick: () => { ui.span = n; keepPrefs(); render(); } }, label))),", "onclick: () => { ui.span = n; render(); } }, label))),"),
 ("a half asked for alone still carries its heading", SV, "        ui.scope === 'all' ? h('div.wk-half-head',", "        true ? h('div.wk-half-head',"),
 ("with everything listed the halves have no heading", SV, "        ui.scope === 'all' ? h('div.wk-half-head',", "        false ? h('div.wk-half-head',"),
 ("the title does not say which half", SV, "!scoped ? (span === 1 ? 'This week’s tasks' : `Tasks for ${num(span)} weeks`) : span === 1 ? `This week${where}` : `${num(span)} weeks${where}`),", "(span === 1 ? 'This week’s tasks' : `Tasks for ${num(span)} weeks`)),"),
 ("the sheet does not say which half it is", SV, "h('h1', span === 1 ? `${half}${half ? 'week' : 'Week'} of ${from}` : `${half}${num(span)} weeks from ${from}`)", "h('h1', span === 1 ? `Week of ${from}` : `${num(span)} weeks from ${from}`)"),
 ("the sheet heads its halves when one was asked for", SV, "      if (ui.scope === 'all') body.push(h('tr.wkp-half',", "      if (true) body.push(h('tr.wkp-half',"),
 ("the print button always says the week", SV, "scoped ? `Print the ${scopeName} sheet` : span === 1 ? 'Print the week'", "false ? `Print the ${scopeName} sheet` : span === 1 ? 'Print the week'"),
 ("a kind chosen in one half is kept in the other", SV, "    if (!chips.some(([id]) => id === ui.filter)) ui.filter = 'all';", "    void chips;"),
 ("the first kind still reads Everything", SV, "const chips = [['all', 'All kinds'],", "const chips = [['all', 'Everything'],"),
 ("the bench chart is back at the foot of Tasks", SV, "      phone || ui.scope === 'field' ? null : Bench.line());", "      phone ? null : Bench.room());"),
 ("the line of bench room shows under Field too", SV, "      phone || ui.scope === 'field' ? null : Bench.line());", "      phone ? null : Bench.line());"),
 ("the line of bench room reads next week", BN, "now = T.monday(E.d2s(App.state.date)), wk = fig.weeks.find(w => w.week === now);\n    const parts", "now = T.monday(E.d2s(App.state.date)), wk = fig.weeks.find(w => w.week > now);\n    const parts"),
 ("a week with nothing in the nursery does not say whose", SV, "h('p.empty.sw-none', span === 1 ? `Nothing is planned${where} for the week of", "h('p.empty.sw-none', span === 1 ? `Nothing is planned for the week of"),
 ("a phone has no way to choose the half", SV, "        h('div.seg.wk-scope', { role: 'group',", "        phone ? null : h('div.seg.wk-scope', { role: 'group',"),
 ("the strip on the timeline goes to Bench room", TL, "root.LRFTraysView.open('live'); else App.setView('trays'); return; }", "root.LRFTraysView.open('room'); else App.setView('trays'); return; }"),
 ("a tray batch's panel opens the Nursery wherever it was", PN, "id: 'fToLive', onclick: () => root.LRFTraysView.open('live') }", "id: 'fToLive', onclick: () => root.LRFTraysView.open() }"),
 ("the weekly amount is missing from the head of Harvest", HV, "root.LRFSeries ? h('button.btn', { type: 'button', id: 'hvPlanBar',", "false ? h('button.btn', { type: 'button', id: 'hvPlanBar',"),
 ("the list to send is back in the bar", HV, "        h('span.grow'), search),", "        h('span.grow'), search, h('button.btn.primary', { type: 'button', id: 'hvShareBtn', onclick: share }, 'A list to send…'), h('button.btn', { type: 'button' }, 'Plan to a weekly amount, from the bar…')),"),
 ("tray crops are offered a weekly amount", HV, "return row.group !== 'micro' && !!root.LRFSeries && !!c", "return !!root.LRFSeries && !!c"),
 ("the row's button opens the tool the old way", HV, "onclick: () => App.openAhead({ mode: 'series', by: 'harvest', cropId: row.cropId }) }, 'plan…')", "onclick: () => App.openAhead({ mode: 'series', cropId: row.cropId }) }, 'plan…')"),
 ("the row's button opens on whatever crop the tool last had", HV, "onclick: () => App.openAhead({ mode: 'series', by: 'harvest', cropId: row.cropId }) }, 'plan…')", "onclick: () => App.openAhead({ mode: 'series', by: 'harvest' }) }, 'plan…')"),
 ("the row's button shows on every row all the time", CSS, "color: var(--ink-2); opacity: 0; pointer-events: none; }", "color: var(--ink-2); opacity: 1; pointer-events: auto; }"),
 ("the button at the head opens the tool the old way", HV, "onclick: () => App.openAhead({ mode: 'series', by: 'harvest' }) }, 'Plan to a weekly amount…')", "onclick: () => App.openAhead({ mode: 'series' }) }, 'Plan to a weekly amount…')"),
 ("the weeks of live trays still point at the Week view", TV, "'Record what was sown, in Tasks')", "'Record what was sown on the Week view')"),
 ("a toast still names the Trays view", SV, "'Whole trays sown to the weekly demand under Live trays, in the Nursery view.'", "'Whole trays sown to the weekly demand on the Trays view.'"),
 ("the Seeds filter still says starting point", SE, "['open', 'Days counted from: not said']];", "['open', 'No starting point']];"),
]
if mode == "list": print(json.dumps({"page": len(PAGE)})); sys.exit(0)
faults = PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
copy = scratch / "mutant"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "r1_check.py"), str(copy), str(scratch / "mutant-shots")], 400, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:190] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
