"""Deliberate faults for step F, which since 0.84 holds that a build moves nothing by itself (node, stepF_test.cjs) and the
Successions page that took the series tool's place (page, successions_check.py): each is put into a copy of the app, and a named check must fail.
usage: python3 -I mutateF.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: every fault against stepF_test.cjs (give OLD=<dir of the previous js> so a fault that moves a figure by itself is caught). page: faults against successions_check.py (about a minute and a half each). list: how many faults there are of each kind, and nothing else.
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
SU, SS, HV, AP = "js/succession.js", "js/successions.js", "js/harvestview.js", "js/app.js"
# node: that the build by itself moves nothing (stepF_test.cjs, against the build before). The series sized by harvest that these
# faults also held went with 0.84; a run's solver has its faults in mutate_runs.py.
NODE = [
 ("a yield moved by itself", "js/engine.js", "const figure = liveTray ? 1 : nonNegative(own ? p.yield : mine != null ? mine : c.yield);", "const figure = liveTray ? 1 : nonNegative(own ? p.yield : mine != null ? mine : c.yield) * 1.01;"),
 ("the forecast moved a day by itself, its totals the same", "js/forecast.js", "if (avail[k]) { row.days[i] += avail[k];", "if (avail[k]) { row.days[Math.min(i + 1, row.days.length - 1)] += avail[k];"),
 ("the bench room moved by itself on one day", "js/engine.js", "        if (date < it.from || date >= it.to) continue;\n        if (it.floor)", "        if (date < it.from || date > it.to) continue;\n        if (it.floor)"),
]
# page: the Successions page (successions_check.py), where the series tool was (about a minute and a half each)
PAGE = [
 ("the page shows what the plan gives with the run, not the run's own", SS, "h('i', { style: { height: `${Math.min(100, (w.run / top) * 100).toFixed(2)}%` } }), h('b', num(w.run, 0))", "h('i', { style: { height: `${Math.min(100, (w.total / top) * 100).toFixed(2)}%` } }), h('b', num(w.total, 0))"),
 ("a week marked short is not marked", SS, "h('div.su-bar' + (w.short ? '.short' : ''), { dataset: { hook: 'succ-week', week: w.key, run: String(w.run), short: String(!!w.short) },", "h('div.su-bar', { dataset: { hook: 'succ-week', week: w.key, run: String(w.run), short: 'false' },"),
 ("the average is not said", SS, "const says = [`Averages ${num(result.average.run, 0)}.`];", "const says = [];"),
 ("the short weeks are not said", SS, "    if (firstShort) says.push(", "    if (false) says.push("),
 ("the spacing is not said", SS, "const spacing = ok && result.every ? `One ${blockName()} every ${plural(result.every, 'day')}.` : '';", "const spacing = '';"),
 ("the Sow column shows the planting day", SS, "h('span.su-col', { dataset: { hook: 'succ-sow' } }, day(x.sow))", "h('span.su-col', { dataset: { hook: 'succ-sow' } }, day(x.plant))"),
 ("the columns are not ruled", "css/app.css", ".su-col { align-self: stretch; display: flex; align-items: center; padding-left: var(--space-12); border-left: 1px solid var(--line);", ".su-col { align-self: stretch; display: flex; align-items: center; padding-left: var(--space-12);"),
 ("Drop does nothing", SS, "onclick: () => set({ drop: [...D.drop, x.n] }) }, 'Drop')", "onclick: () => set({}) }, 'Drop')"),
 ("the amount typed does not reach the solver", SS, "...(by === 'amount' ? { want: +D.want, margin: +D.margin || 0 } : { every: +D.every }),", "...(by === 'amount' ? { want: 10, margin: +D.margin || 0 } : { every: +D.every }),"),
 ("what the plan already gives is not said", SS, "h('p.su-note', { dataset: { hook: 'succ-have' } }, have > 1e-9 ?", "h('p.su-note', { dataset: { hook: 'succ-have' } }, false ?"),
 ("what has no bed is not said", SS, "    for (const u of result.unplaced) {", "    for (const u of []) {"),
 ("the frost is not said on its row", SS, "      if (x.frost) out.push(h('p.su-said', { dataset: { hook: 'succ-frost-said' } }", "      if (false) out.push(h('p.su-said', { dataset: { hook: 'succ-frost-said' } }"),
 ("Add adds without its run", SS, "if (!App.addRun(result, `Add a succession of ${lower(crop)}: ${plural(n, 'planting')}`)) { render(); return; }", "if (!App.addPlantings(result.sowings.map(x => x.p), 'Add')) { render(); return; }"),
 ("the answer has no Undo", SS, "can ? h('button.btn.small', { type: 'button', dataset: { hook: 'succ-undo' }", "false ? h('button.btn.small', { type: 'button', dataset: { hook: 'succ-undo' }"),
 ("the kept run's plantings are not links", SS, "h('button.link', { type: 'button', dataset: { hook: 'succ-kept-link' }, title: 'Show this planting on the Timeline', onclick: () => { App.setView('timeline'); App.select({ type: 'planting', id: x.p.id }); } }", "h('button.link', { type: 'button', dataset: { hook: 'succ-kept-link' }, title: 'Show this planting on the Timeline', onclick: () => { App.setView('timeline'); } }"),
 ("Remove run takes its plantings without being asked", SS, "const eng = App.state.engine, crop = eng.crop(run.cropId), all = UI_STATE.removeAll && n > 0;", "const eng = App.state.engine, crop = eng.crop(run.cropId), all = n > 0;"),
 ("See them on the Timeline draws nothing", SS, "    if (!UI_STATE.shown || UI_STATE.pick !== 'draft' || !App.state.ready) return null;", "    if (true) return null;"),
 ("the ghosts stay on the Timeline after the page is opened again", SS, "if (UI_STATE.shown) { UI_STATE.shown = false; App.emit('ghost'); }", "if (UI_STATE.shown) { App.emit('ghost'); }"),
 ("a bed opens the page on the crop's first garden", SS, "const selected = (bed && gardens.find(g => g.garden.id === bed.gardenId && g.kind === eng.spaceKind(bed))) ||", "const selected = false ||"),
 ("a planting opens the page without its variety", SS, "    if (source && source.varietyId) D.varietyId = source.varietyId;\n", ""),
 ("the Forecast opens the page by beds", HV, "App.openAhead({ mode: 'succession', by: 'amount', cropId: row.cropId, thing: row.thing || '',", "App.openAhead({ mode: 'succession', by: 'beds', cropId: row.cropId, thing: row.thing || '',"),
 ("the Forecast supplies an extra week after the selected period", HV, "to: E.d2s(col.end), want", "to: E.d2s(E.addDays(col.end, 7)), want"),
 ("the Forecast plans the entire sales target even when there is stock", HV, "target.valueAsNumber - available) * 7", "target.valueAsNumber) * 7"),
 ("the removal checkbox leaves the explanation stale", SS, "removalNote.textContent = removalText();", "void removalNote;"),
 ("the library arms the crop as well", "js/panels.js", "      if (series) { App.openAhead({ mode: 'succession', cropId: series.dataset.succession }); return; }", "      if (series) { App.arm({ cropId: series.dataset.succession }); App.openAhead({ mode: 'succession', cropId: series.dataset.succession }); return; }"),
 ("Cancel keeps the run being planned", SS, "    Object.assign(UI_STATE, { shown: false, answer: null, planning: false });", "    Object.assign(UI_STATE, { shown: false, answer: null });"),
 ("a crop on a yield nobody has checked is planned to an amount", SU, "      if (rests.open) return { unchecked: true, error: openWhy(o.crop) };\n", ""),
 ("a variety's own unit is not read for the amount it starts on (Codex on #103)", SS, "    const unit = unitFor(eng, crop, D.thing, D.varietyId), rows = m.rows.filter(", "    const unit = unitFor(eng, crop, D.thing), rows = m.rows.filter("),
 ("a kept run's waiting planting is not counted by the tick (Codex on #103)", SS, "all ? h('label.su-tick', tick, h('span', `Take its ${plural(all, 'planting')} out too`)) : null,", "list.length ? h('label.su-tick', tick, h('span', `Take its ${plural(list.length, 'planting')} out too`)) : null,"),
 ("a kept run's waiting planting is not said", SS, "    if (held.length) out.append(h('p.su-note', { dataset: { hook: 'succ-kept-waiting' } }", "    if (false) out.append(h('p.su-note', { dataset: { hook: 'succ-kept-waiting' } }"),
 ("the runs list leaves out a run's plantings under To place", SS, "n = S.runPlantings(App.state.plan, run.id).length + App.waiting().filter(w => w.run && w.run.id === run.id).length;", "n = S.runPlantings(App.state.plan, run.id).length;"),
 ("the page's figures leave out the plantings of runs under To place", SS, "inRuns = [...App.state.plan.plantings, ...App.waiting()].filter(p => p.run && ids.has(p.run.id)).length;", "inRuns = App.state.plan.plantings.filter(p => p.run && ids.has(p.run.id)).length;"),
 ("a planting of a run sent to To place loses its mark, and is placed again outside the run", AP, "const w = { ...p }, asked =", "const w = (({ run, ...q }) => q)(p), asked ="),
 ("another variety put beside a planting of a run is in the run", AP, "'startFt', 'bedLayout', 'run']) delete d[key];", "'startFt', 'bedLayout']) delete d[key];"),
 ("a copy of a planting of a run, dropped on the page, is in the run", "js/rails.js", "delete next.run; delete next.startedFrom; }", "delete next.startedFrom; }"),
 ("the page says “series”", SS, "'Nothing is added to the plan until you press Add.'", "'Nothing is added to the plan until you press Add. A series.'"),
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
        out = subprocess.run(["node", str(tests / "stepF_test.cjs"), str(copy), str(plan)] + ([os.environ["OLD"]] if os.environ.get("OLD") else []), capture_output=True, text=True, timeout=300).stdout
    else:
        out = alone([sys.executable, "-I", str(tests / "successions_check.py"), str(copy), str(scratch / "mutant-shots")], 600, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
    try:
        d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else x for x in d["failed"]]
    except Exception: names = ["(the test did not finish: " + out[-200:].replace("\n", " ") + ")"]
    real = [n for n in names if n != "the test ran to its end" and not n.startswith("(the test did not finish")]
    if name is None: already = unfaulted(real, bool(real) or not names); continue
    real = [n for n in real if already is not None and n not in already]
    (caught if real else missed).append((name, (real or names)[:2]))
    print(("caught " if real else "MISSED ") + name + " :: " + "; ".join((real or names)[:2])[:200] + (" (which fails with no fault in it too)" if names and not real else ""), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": [m[0] for m in missed], "broken": [b[0] for b in broken]}))
