"""Deliberate faults for preview 0.34 (the bed panel build, stages a and b): each is put into a copy, and a named check must fail.
usage: python3 -I mutate_bp.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against bedpanel_check.py (about a minute each). list: how many faults there are, and nothing else.
(The node mode ran bedpanel_test.cjs, the proof of one past build. That proof is retired, tests/what_changed.cjs with tests/this-build.json does its work, and the mode is taken out.)
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
AP, PN, ME, FC, HV, SR, MN, EN, CSS = "js/app.js", "js/panels.js", "js/mapedit.js", "js/forecast.js", "js/harvestview.js", "js/series.js", "js/main.js", "js/engine.js", "css/app.css"
LABEL = os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)"; OTHER = LABEL[:-1] + ("0" if LABEL[-1] != "0" else "1")   # the build's label, as tests/env.sh reads it from the page's own script, and one that is not it
PRICE = ("const y = personal ? { ...y0, price: 0 } : y0;", "const y = y0;")
ATEND = ("if (direction === 'undo' && Number.isInteger(op.at) && op.at <= list.length) list.splice(op.at, 0, to); else list.push(to);", "list.push(to);")
PAGE = [
 ("the panel never says Saved", PN, "      if (headEl) headEl.after(savedLine());\n", ""),
 ("Saved comes with no Undo", PN, "last.canUndo ? h('button.link', { type: 'button', dataset: { saved: 'undo' }", "false ? h('button.link', { type: 'button', dataset: { saved: 'undo' }"),
 ("Saved does not say what changed", PN, "h('span', ` · ${last.label} · ${clock(last.at)}`)", "h('span', ` · ${clock(last.at)}`)"),
 ("Saved never goes quiet", PN, "    el.lrfTimer = setTimeout(() => { if (el.isConnected) fillSaved(el); }, SAID_FOR - (Date.now() - last.at) + 30);\n", ""),
 ("a refusal is said in a toast only", AP, "if (no) { const text = refusalText(no, engine); state.last = { kind: 'refused', text, at: Date.now() }; toast(text); emit('refused'); return false; }", "if (no) { toast(refusalText(no, engine)); return false; }"),
 ("a change is said again in the next panel opened", PN, "const fresh = last && Date.now() - last.at < SAID_FOR && lastSel === selKey();", "const fresh = last && Date.now() - last.at < SAID_FOR;"),
 ("a change that closes its own panel is never said", PN, "      sayIfGone();\n", ""),
 ("the bed's panel has no such line", PN, "else if (bed) { renderBed(host, bed); own = true; }", "else if (bed) { renderBed(host, bed); }"),
 ("the layout's panel has no such line", ME, "    if (headEl && root.LRFPanels && root.LRFPanels.savedLine) headEl.after(root.LRFPanels.savedLine());\n", ""),
 ("Undo puts a record back at the end of its list", AP, *ATEND),
 ("Undo runs a step forwards", AP, "for (const op of direction === 'undo' ? ops.slice().reverse() : ops) {", "for (const op of ops) {"),
 ("the fix sets the length when it is pressed", ME, "S.propose = { l, why: String(focus.propose.why || ''), ids: S.picked.slice() }; refresh(); }", "S.propose = { l, why: String(focus.propose.why || ''), ids: S.picked.slice() }; resize('l', l); }"),
 ("the fix changes the beds itself and then opens the layout", PN, "dataset: { fix: 'layout' }, onclick: () => root.LRFMapEdit.open(", "dataset: { fix: 'layout' }, onclick: () => App.updateBeds(mates.map(b => b.id), { l: want }) || root.LRFMapEdit.open("),
 ("the fix picks one bed of the garden", PN, "root.LRFMapEdit.open({ bedIds: mates.map(b => b.id), propose:", "root.LRFMapEdit.open({ bedIds: mates.slice(0, 1).map(b => b.id), propose:"),
 ("the fix does not say where the figure comes from", ME, "`${offer.why ? offer.why.charAt(0).toUpperCase() + offer.why.slice(1) + '; ' : ''}", "`"),
 ("the offered length goes round the guard rail", ME, "id: 'leOfferSet', onclick: () => resize('l', offer.l) }", "id: 'leOfferSet', onclick: () => { change('Set', new Map(beds.map(b => [b.id, { l: offer.l }]))); S.propose = null; } }"),
 ("a refused length is said in a toast only", ME, "    if (bad) { App.refuse(`${clashText(bad)} at that size: nothing was changed.`); refresh(); return; }\n    if (!change(`Change ${describe(beds.map(b => b.id))}", "    if (bad) { toast(`${clashText(bad)} at that size: nothing was changed.`); refresh(); return; }\n    if (!change(`Change ${describe(beds.map(b => b.id))}"),
 ("“Leave them as they are” leaves the offer standing", ME, "id: 'leOfferDrop', onclick: () => { S.propose = null; refresh(); } }", "id: 'leOfferDrop', onclick: () => { refresh(); } }"),
 ("Enter does not set the offered length", ME, "if (offer && e.key === 'Enter' && +e.target.value === offer.l)", "if (false)"),
 ("the offer is not put in the field", ME, "number('fLayL', offer ? offer.l : l,", "number('fLayL', l,"),
 ("the old one-press fix is still worded as before", PN, "h('b', `Set ${mates.length === 1 ? 'this bed' : 'these beds'} to ${num(want, 1)} ft in Edit layout…`)", "h('b', `The beds are ${num(want, 1)} ft to ${num(want, 1)} ft`)"),
 ("a personal planting still counts as revenue", FC, *PRICE),
 ("marking says nothing of the season's worth", AP, "    toast(`${label} · ${moved} · ${Math.abs(now - was) >= 0.5 ?", "    if (false) toast(`${label} · ${moved} · ${Math.abs(now - was) >= 0.5 ?"),
 ("marking counts no planting in its toast", AP, "const q = eng.planting(p.id), a = !!q && F.useOf(eng, q).personal, b = F.useOf(engine, p).personal;", "const a = F.useOf(eng, p).personal, b = F.useOf(engine, p).personal;"),
 ("Commercial pressed back is written on the planting", AP, "if (want && want !== F.follows(eng, kind, after)) after.use = want;", "if (want) after.use = want;"),
 ("the planting's panel has no Grown for", PN, "        useField,\n        yieldLine(eng, p, r)),", "        yieldLine(eng, p, r)),"),
 ("a personal planting's panel still shows dollars", PN, "${personal ? ', for personal use: not counted as revenue' : y.price > 0 ?", "${false ? ', for personal use: not counted as revenue' : y.price > 0 ?"),
 ("the planting's panel does not say whose word it follows", PN, "dataset: { use: use.use, by: use.by } }, useBtn('commercial', 'Commercial')", "dataset: { use: use.use, by: 'default' } }, useBtn('commercial', 'Commercial')"),
 ("the bed's panel does not say whom it is grown for", PN, "    if (root.LRFMapEdit && (soil || !eng.isPool(bed))) {\n      const use = root.LRFForecast.useOfBed(eng, bed);", "    if (false) {\n      const use = root.LRFForecast.useOfBed(eng, bed);"),
 ("the bed's panel changes whom it is grown for itself", PN, "onclick: () => root.LRFMapEdit.open({ bedId: bed.id, field: 'leUse' }) }, 'Change…')", "onclick: () => App.setUse('bed', [bed.id], use.personal ? 'commercial' : 'personal') }, 'Change…')"),
 ("with a whole garden picked, the layout marks its beds one by one", ME, "App.setUse(whole ? 'garden' : 'bed', whole ? [garden.id] : beds.map(b => b.id), e.target.value)", "App.setUse('bed', beds.map(b => b.id), e.target.value)"),
 ("the layout's Grown for is missing", ME, "    if (F && F.useOfBed && App.setUse) {", "    if (false) {"),
 ("the list to send holds personal plantings", HV, "const m = model('commercial'), left = model().personal, wk", "const m = model(), left = model().personal, wk"),
 ("the list to send does not say what it leaves out", HV, "left ? h('p.dlg-hint', { id: 'hvShareOwn' }", "false ? h('p.dlg-hint', { id: 'hvShareOwn' }"),
 ("Harvest offers the choice with nothing marked", HV, "        marked ? h('div.seg.hv-use'", "        true ? h('div.seg.hv-use'"),
 ("Commercial on Harvest shows everything", HV, "const shownModel = () => model(model().personal ? use : 'all');", "const shownModel = () => model('all');"),
 ("the headline does not say which plantings it counts", HV, "(kinds || 'nothing is being picked') + which)", "(kinds || 'nothing is being picked'))"),
 ("the worth tile does not say it is commercial only", HV, "${marked ? ' · commercial plantings only' : ''}", ""),
 ("Harvest has no note of what is marked", HV, "      marked ? h('p.hv-note', { id: 'hvOwnNote' }", "      false ? h('p.hv-note', { id: 'hvOwnNote' }"),
 ("the weekly amount does not say personal use is left out", SR, "${ownUse(eng, P.cropId) ? '. Plantings for personal use are not counted as giving any' : ''}", ""),
 ("the label is another build's", MN, "Preview " + LABEL, "Preview " + OTHER),
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
    out = alone([sys.executable, "-I", str(tests / "bedpanel_check.py"), str(copy), str(scratch / "mutant-shots")], 400, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:190] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
