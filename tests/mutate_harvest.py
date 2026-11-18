"""Deliberate faults for the card's harvest choice: to the season's end, or for a set number of days, on the card and the list;
each place's last picking; the sheet that says what a change moves and what the season is worth before and after; the fields it
writes; the yield's row, "Marketable yield". Each is put into a copy of the app folder, and a line of harvest_choice_check.py that
passed with no fault in it must fail.
usage: python3 -I mutate_harvest.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against harvest_choice_check.py (about half a minute a fault).
list: how many faults there are, and nothing else.
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
YC, AS, AP, CSS = "js/yieldcard.js", "js/assume.js", "js/app.js", "css/app.css"
PAGE = [
 ("every crop is shown picked for a number of days", YC, "dataset: { hook: 'harvest-choice', on: w.season ? 'season' : 'days' } },", "dataset: { hook: 'harvest-choice', on: 'days' } },"),
 ("a crop with the list's days is shown picked to the season's end where its record says so", YC, "const season = hc.days.mine == null && hc.season, offer", "const season = hc.season, offer"),
 ("the card never says the garden's close ends a date sooner", YC, "const shut = own && se && se.close && own > se.close && !cut ? h(", "const shut = false ? h("),
 ("the card says the frost cuts a date short where the garden closes first", YC, "own > se.frost && !(se.close && se.close < se.frost) ? h(", "own > se.frost ? h("),
 ("the number offered is the days a total is spoken of over, not the crop's own days", YC, "offer = Math.max(1, Math.round(+c.hw > 0 ? +c.hw : hc.nominal || 1));", "offer = Math.max(1, Math.round(hc.nominal || 1));"),
 ("the season's end is never pressed", YC, "h('button.yc-hw-end', { type: 'button', 'aria-pressed': String(w.season),", "h('button.yc-hw-end', { type: 'button', 'aria-pressed': 'false',"),
 ("last picking counts the plantings that keep their own days", YC, "      if (p.cropId !== c.id || !follows(eng, p)) continue;\n      const env = envOfP(eng, p), r = env ? eng.calc(p) : null;", "      if (p.cropId !== c.id) continue;\n      const env = envOfP(eng, p), r = env ? eng.calc(p) : null;"),
 ("last picking gives a date to a planting that is never picked", YC, "      if (!r || !(r.harvestDays > 0) || !root.LRFEngine.validDate(r.last)) continue;", "      if (!r || !root.LRFEngine.validDate(r.last)) continue;"),
 ("last picking says the earliest date as the latest", YC, "to: iso(ends.get(env).hi), n: String(ends.get(env).n)", "to: iso(ends.get(env).lo), n: String(ends.get(env).n)"),
 ("a variety's own days are not seen", YC, "return !owns(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && owns(v)) && !!b && !eng.isRack(b);", "return !owns(p) && !p.harvestEnd && !!b && !eng.isRack(b);"),
 ("nothing is asked before the change is taken", YC, "    if (m.n || moved || m.beds.length || m.things) {", "    if (false) {"),
 ("Cancel takes the change all the same", YC, "if (!await askMoves(eng, c, ops, label, to === 'season' ? 'Pick to the season’s end' : to == null ? 'Go back' : `Pick for ${to} days`)) { redraw(); return false; }", "await askMoves(eng, c, ops, label, to === 'season' ? 'Pick to the season’s end' : to == null ? 'Go back' : `Pick for ${to} days`);"),
 ("the sheet gives the season's worth after as it was before", YC, "const worth = [study(eng).worth, F.build(next).rows.reduce((t, r) => t + r.worth, 0)];", "const worth = [study(eng).worth, study(eng).worth];"),
 ("the sheet names no bed booked twice", YC, "beds = [...new Set([...then].filter(([k]) => !was.has(k))", "beds = [...new Set([...then].filter(([k]) => false)"),
 ("the sheet's dates after are the dates before", YC, "nowFrom: x.now.lo ? iso(x.now.lo) : '', nowTo: x.now.hi ? iso(x.now.hi) : ''", "nowFrom: x.was.lo ? iso(x.was.lo) : '', nowTo: x.was.hi ? iso(x.was.hi) : ''"),
 ("the sheet gives a planting that is not picked the season's end as its last picking", YC, "        if (!(r.harvestDays > 0)) { side.none++; continue; }\n", ""),
 ("the sheet counts no planting that keeps its own days", YC, "      if (!follows(eng, p)) { own++; continue; }", "      if (!follows(eng, p)) continue;"),
 ("a press on For takes a day more than offered", YC, "setWindow(c, typed >= 1 && typed <= 400 ? typed : w.offer, redraw); } }, 'For'),", "setWindow(c, typed >= 1 && typed <= 400 ? typed : w.offer + 1, redraw); } }, 'For'),"),
 ("to the season's end leaves the crop's own record as it was", AP, "    if (!c || c.harvestMode === 'season') return list;", "    return list;"),
 ("to the season's end writes a record that has lost the crop's other figures", AP, "after: { ...(own || { id: cropId }), harvestMode: 'season' } }];", "after: { id: cropId, harvestMode: 'season' } }];"),
 ("to the season's end leaves the list's days standing", AP, "    if (season) change = { ...change, days: null };", "    if (season) { change = { ...change }; delete change.days; }"),
 ("the message does not say the season's worth when it stays", AP, ": options.shown ? `the season’s worth stays ${dollars(hit.worth[0])}` : '';", ": '';"),
 ("the list keeps its plain number box", AS, "    td.replaceChildren(YC.windowChoice(eng, c, hc, td.firstChild, true, schedule));", ""),
 ("a number typed on the list is taken without the sheet", AS, "save: n => YC.setWindow(c, n, schedule) });", "save: n => App.setSell(c.id, { days: n }, n == null ? `${c.name}: harvest days as before` : `${c.name}: picked for ${n} days`) });"),
 ("the yield's row reads as it did", YC, "`Marketable yield ${PER_SAY[hc.basis]}${weekly ? ' per week' : ''}`;", "`Gives, packed, ${PER[hc.basis]}${weekly ? ' a week' : ''}`;"),
 ("the yield's hint does not say packed weight", YC, ": pattern === 'once' ? 'packed weight or count, in all, taken the day it is cleared' : 'packed weight or count, in all, over its harvest days';", ": pattern === 'once' ? 'in all, taken the day it is cleared' : 'in all, over its harvest days';"),
 # E2c: a last picking for each place, and the harvest days said once
 ("a place's last picking shows the season's end where he set a date", YC, "const se = eng.seasonEndOf(c.id, env, year), mine = hc.until[env] || null,", "const se = eng.seasonEndOf(c.id, env, year), mine = null,"),
 ("a place's last picking says it is his whatever it is", YC, "whose = mine ? 'yours' : se ? ENDS_BY[se.by] : '';", "whose = 'yours';"),
 ("a place's last picking says the frost where the year ends", YC, "  const ENDS_BY = { frost: 'your first frost', cover: 'the first frost, under cover', close: 'the garden closes', record: 'the crop’s record', year: 'the year’s end' };", "  const ENDS_BY = { frost: 'your first frost', cover: 'the first frost, under cover', close: 'the garden closes', record: 'the crop’s record', year: 'your first frost' };"),
 ("a crop picked to the season's end gives no date to set", YC, "const dated = env => hw.season && hc.pattern.value !== 'once' && !hc.micro && env !== 'tray';", "const dated = env => false;"),
 ("a date picked for a place is taken without the sheet", YC, "    if (!await askMoves(eng, c, ops, label, md ? 'End it then' : 'Go back')) { redraw(); return false; }\n", ""),
 ("Cancel on a place's date takes it all the same", YC, "if (!await askMoves(eng, c, ops, label, md ? 'End it then' : 'Go back')) { redraw(); return false; }", "await askMoves(eng, c, ops, label, md ? 'End it then' : 'Go back');"),
 ("a date picked for one place is written for every place", AP, "for (const [env, md] of Object.entries(change.until)) { if (!eng.ENVS.includes(env)) continue;", "for (const [, md] of Object.entries(change.until)) for (const env of ['field', 'tunnel', 'heated', 'tower']) {"),
 ("a place's date cleared is kept", AP, "until[env] = md; else delete until[env]; }", "until[env] = md; }"),
 ("a date past the frost is not said to be cut short", YC, "const cut = own && se && se.frost && own > se.frost && !(se.close && se.close < se.frost) ?", "const cut = false ?"),
 ("picked for a set number of days, Last picking says the days again", YC, ": said(env) || why('counted from the first picking')))));", ": said(env) || why(`${hw.days} days after the first`)))));"),
 ("the chosen side is not in ink", CSS, ".yc-hw button[aria-pressed=\"true\"], .yc-hw-n.on { background: var(--ink); color: var(--surface); }\n", ""),
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
copy = scratch / "mutant-harvest"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "harvest_choice_check.py"), str(copy), str(scratch / "mutant-harvest-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
