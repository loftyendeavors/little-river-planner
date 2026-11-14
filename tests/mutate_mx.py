"""Deliberate faults for previews 0.35 and 0.36 (the bed panel build, stage c: mixed beds): each is put into a copy, and a named check must fail.
usage: python3 -I mutate_mx.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against mixed_check.py (about a minute each). list: how many faults there are, and nothing else.
(The node mode ran mixed_test.cjs, the proof of one past build. That proof is retired, tests/what_changed.cjs with tests/this-build.json does its work, and the mode is taken out.)
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
AP, PN, MP, RL, SR, MN, EN = "js/app.js", "js/panels.js", "js/map.js", "js/rails.js", "js/series.js", "js/main.js", "js/engine.js"
LABEL = os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)"; OTHER = LABEL[:-1] + ("0" if LABEL[-1] != "0" else "1")   # the build's label, as tests/env.sh reads it from the page's own script, and one that is not it
RECORDED = ("    if (recorded(o.p)) return 'recorded';\n", "")
TOWAIT = ("    if (by === 'replace') ops.push(waitingOp([...waiting(), ...way.waiting]));\n", "")
PAGE = [
 ("a held bed is refused as before, with no question", AP, "if (res.state === 'blocked' && res.why === 'held' && asksToShare(payload) && !target.noSwap && bed && eng.isSoilBed(bed)) {", "if (false) {"),
 ("the question opens in the middle of the page, over the bed", AP, "const el = state.view === 'map' ? document.querySelector(`#mapBeds [data-bed=", "const el = false ? document.querySelector(`#mapBeds [data-bed="),
 ("the drop plants at once, without asking", AP, "      by = await askShare(sh, payload);\n", "      by = 'length';\n"),
 ("the × splits the bed", AP, "title: 'Close. Nothing is planted.', onclick: () => done(null) }", "title: 'Close. Nothing is planted.', onclick: () => done('length') }"),
 ("Escape leaves the question open", AP, "const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };", "const onKey = e => { if (false) { e.stopPropagation(); done(null); } };"),
 ("a click elsewhere leaves the question open", AP, "      setTimeout(() => { if (asking === done) root.addEventListener('pointerdown', onAway, true); }, 0);\n", ""),
 ("the question does not say who holds the bed", AP, "h('b', `${bedLabel(bed)} is held by ${n === 1 ? cropLabel(first.p) : `${cropLabel(first.p)} and ${n - 1} more`}`)", "h('b', `${bedLabel(bed)} is held`)"),
 ("the question does not say what the plants come to", AP, "return list.length ? ` ${plantsSaid(list[0])}${list.length > 1 ? `, and ${list.length - 1} more likewise` : ''}.` : '';", "return '';"),
 ("the rows way is filed as the length way", AP, "way('rows', 'Split the rows', lines.rows)", "way('length', 'Split the rows', lines.rows)"),
 ("a split does not begin the mixing", AP, "    setMixing(by === 'replace' ? null : { bedId: bed.id, by });", "    setMixing(null);"),
 ("a replacement begins the mixing", AP, "    setMixing(by === 'replace' ? null : { bedId: bed.id, by });", "    setMixing({ bedId: bed.id, by });"),
 ("the question is asked on every drop", AP, "let by = state.mixing && state.mixing.bedId === target.bedId && sh[state.mixing.by] ? state.mixing.by : null;", "let by = null;"),
 ("the newcomer is not selected", AP, "    select({ type: 'planting', id: way.p.id });\n    toast(by === 'replace'", "    toast(by === 'replace'"),
 ("a split says nothing of the season's worth", AP, "`, as each of the ${n} has` : ''} · ${worthSaid(was, now)}`", "`, as each of the ${n} has` : ''}`"),
 ("the hint does not say a drop will split again", AP, "res.text = way ? (state.mixing.by === 'rows'", "res.text = false ? (state.mixing.by === 'rows'"),
 ("the pill is never drawn", MP, "    App.on('plan', drawMixing); App.on('mixing', drawMixing); App.on('date', drawMixing); App.on('view', drawMixing);\n", ""),
 ("Done does nothing", MP, "onclick: () => App.endMixing() }, 'Done')", "onclick: () => {} }, 'Done')"),
 ("the bed stays outlined after Done", MP, "    for (const el of document.querySelectorAll('#mapBeds .bed[data-mixing]')) el.removeAttribute('data-mixing');", "    void 0;"),
 ("Escape does not end the mixing", AP, "if (e.key === 'Escape' && state.mixing && !asking &&", "if (false && state.mixing && !asking &&"),
 ("selecting another bed keeps the mixing going", AP, "if (!inBed) setMixing(null); });", "});"),
 ("the line between two shares does not move", MP, "res = Rails.slide(App.state.engine, cur.p, gesture.edge,", "res = Rails.stretch(App.state.engine, cur.p, gesture.edge,"),
 ("the tip does not say what the neighbour keeps", MP, "res.other ? h('span.tip-spec', { id: 'tipOther' }", "false ? h('span.tip-spec', { id: 'tipOther' }"),
 ("the moved line is two steps", MP, "(res.ops ? App.commit(`Move the line between ${App.cropLabel(done.cur.p)} and ${App.cropLabel(res.other.p)}`, res.ops)", "(res.ops ? (App.commit('Move the line between, one', [res.ops[0]], { unchecked: true }), App.commit(`Move the line between ${App.cropLabel(done.cur.p)} and ${App.cropLabel(res.other.p)}`, [res.ops[1]], { unchecked: true }))"),
 ("the panel does not list who shares the bed", PN, "        eng.isSoilBed(bed) ? matesBox(eng, p) : null,\n", ""),
 ("“Make them equal” does nothing", PN, "id: 'fEqual', onclick: () => App.equalShares(p.id) }", "id: 'fEqual', onclick: () => {} }"),
 ("equal shares that are equal already are written again", AP, "    if (!res.ops.length) { toast('They already have equal shares.'); return false; }\n", "    if (!res.ops.length) { commit('Equal shares', [{ before: p, after: { ...p } }], { unchecked: true }); return false; }\n"),
 ("“Send to To place” removes the planting", AP, "    ops.push(waitingOp([...waiting(), w]));\n", ""),
 ("the ones left do not take up its ground", AP, "      if (others.length >= 2) { const res = Rails.equalize(without, others.map(x => x.p.id)); if (res.ops) ops.push(...res.ops); }", "      if (false) { const res = Rails.equalize(without, others.map(x => x.p.id)); if (res.ops) ops.push(...res.ops); }"),
 ("“Several varieties” is not offered", PN, "canMix && !several ? h('button.linkish', { type: 'button', id: 'fSeveral'", "false ? h('button.linkish', { type: 'button', id: 'fSeveral'"),
 ("the planting's own variety can be unticked", PN, "checked: here || there || several.picked.has(v.id), disabled: here || there,", "checked: here || there || several.picked.has(v.id), disabled: there,"),
 ("the bed is divided as soon as a box is ticked", PN, "onchange: e => { if (e.target.checked) several.picked.add(v.id); else several.picked.delete(v.id); redraw(); } });", "onchange: e => { if (e.target.checked) { several.picked.add(v.id); App.addVarieties(p.id, [v.id], by); } else several.picked.delete(v.id); redraw(); } });"),
 ("it does not say what the plants come to before dividing", PN, " ${r.c.vname || r.c.name} goes from ${num(plan.plants[0])} plants to ${num(plan.plants[1])}.", ""),
 ("By rows divides along the bed", PN, "plan = picked.length ? App.planVarieties(p.id, picked, by) : null;", "plan = picked.length ? App.planVarieties(p.id, picked, 'length') : null;"),
 ("Cancel divides the bed", PN, "id: 'mixCancel', onclick: () => { several = null; render(); } }", "id: 'mixCancel', onclick: () => { App.addVarieties(p.id, [...several.picked], several.by); several = null; render(); } }"),
 ("the added varieties get the day the map is on", AP, "const d = { ...p0, id: uid(), varietyId };", "const d = { ...p0, id: uid(), varietyId, date: E.d2s(state.date) };"),
 ("what is in the bed already is not shown", PN, "inBed = new Set(mates.filter(x => x.p.cropId === p.cropId).map(x => x.p.varietyId || ''))", "inBed = new Set()"),
 ("what is replaced is removed outright", AP, *TOWAIT),
 ("the waiting planting's panel gives the wrong reason", SR, "wait.why ? h('p.help', { id: 'wtWhy' }, wait.from ?", "wait.why ? h('p.help', { id: 'wtWhy' }, false ?"),
 ("a planting with recorded work is split or replaced", RL, *RECORDED),
 ("a planting no longer trades places", AP, "payload.plantingId && !target.noSwap) res = Rails.swap(eng, payload, target) || res;", "payload.plantingId && !target.noSwap && false) res = Rails.swap(eng, payload, target) || res;"),
 ("on the Timeline the drop is not asked", AP, "    if (result.state === 'split') { shareDrop(payload, { bedId, date, ...aim }, result); return null; }", "    if (result.state === 'split' && state.view === 'map') { shareDrop(payload, { bedId, date, ...aim }, result); return null; }"),
 ("the label is another build's", MN, "Preview " + LABEL, "Preview " + OTHER),
 ("the outline is drawn before the map is built again, as 0.35 went live", MP, "    App.on('plan', build);\n    // after the map is built again, not before: building draws every bed afresh, and the bed being mixed must keep its outline\n    App.on('plan', drawMixing);", "    App.on('plan', drawMixing);\n    App.on('plan', build);\n   "),
 ("the outline is lost on the second drop", MP, "    App.on('plan', drawMixing); App.on('mixing', drawMixing);", "    App.on('mixing', drawMixing);"),
 ("a bed booked twice is called a shared bed", PN, "const twice = eng.conflicts(p, eng.calc(p)).some(o => !o.rest);", "const twice = false;"),
 ("sharing a bed that is booked twice does not say it is settled", AP, "${settled > 0 ? ' · that ground is no longer booked twice' : ''}", ""),
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
    out = alone([sys.executable, "-I", str(tests / "mixed_check.py"), str(copy), str(scratch / "mutant-shots")], 400, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:190] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
