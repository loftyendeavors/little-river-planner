"""Deliberate faults for preview 0.37 (the farm's dates, "Season…"; and the two-browser check of the farm photo, whose fix is 0.35's): each is put into a copy, and a named check must fail.
usage: python3 -I mutate_season.py <app> <scratch> <tests-dir> <repo> [page | photo | list] [words…]     env FROM=, TO= to run a part, WIDTH= for the page
page: against season_check.py (under a minute each). photo: against photo_keep_check.py (two browsers and the sync service: about a minute each). list: how many faults there are of each kind, and nothing else.
(The node mode ran season_test.cjs, the proof of one past build. That proof is retired, tests/what_changed.cjs with tests/this-build.json does its work, and the mode is taken out.)
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests, repo = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "page"; words = [w.lower() for w in sys.argv[6:]]
LABEL = os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)"; OTHER = LABEL[:-1] + ("0" if LABEL[-1] != "0" else "1")   # the build's label, as tests/env.sh reads it from the page's own script, and one that is not it
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
AP, SE, FD, MN, EN, CSS = "js/app.js", "js/season.js", "js/farmdates.js", "js/main.js", "js/engine.js", "css/app.css"
STRAY = ("return Object.keys(diff).length ? { ...settings, ...diff } : settings;", "return Object.keys(diff).length ? { ...settings, ...diff, seasonEdited: true } : settings;")
NOYIELD = ("if (Math.abs(ua - ub) > 1e-6) yields.push(", "if (false) yields.push(")
SWAP = ("if (!ta && tb) outside.push({ ...base, why: tb }); else if (ta && !tb) inside.push({ ...base, why: ta });", "if (!ta && tb) inside.push({ ...base, why: tb }); else if (ta && !tb) outside.push({ ...base, why: ta });")
KEEP1 = ("const keepMap = !parsed.zip && !parsed.image && !!wasInfo.mapImage", "const keepMap = planOnly && !parsed.image && !!wasInfo.mapImage")
PAGE = [
 ("the button does nothing", SE, "    $('seasonEdit').addEventListener('click', openDates);\n", ""),
 ("Escape does not leave the window", SE, "id: 'seasonDlg', oncancel: e => { e.preventDefault(); close(); } }", "id: 'seasonDlg', oncancel: e => { e.preventDefault(); } }"),
 ("the × applies what was typed", SE, "title: 'Close. Nothing is changed.', onclick: () => close() }", "title: 'Close. Nothing is changed.', onclick: () => { App.setFarmDates(draft); close(); } }"),
 ("Cancel applies what was typed", SE, "id: 'fdCancel', onclick: () => close() }", "id: 'fdCancel', onclick: () => { App.setFarmDates(draft); close(); } }"),
 ("a date is written as it is typed", SE, "      const view = App.farmDatesPreview(draft), keys = Object.keys(view.changed), eng = view.engine || App.state.engine;\n", "      if (!App.farmDatesPreview(draft).idle) App.setFarmDates(draft);\n      const view = App.farmDatesPreview(draft), keys = Object.keys(view.changed), eng = view.engine || App.state.engine;\n"),
 ("Apply can be pressed with nothing changed", SE, "apply.disabled = !!view.errors.length || !keys.length;", "apply.disabled = false;"),
 ("the window counts every planting as changing", SE, "h('b.fd-head', { id: 'fdHead' }, ids.size ? `${plural(ids.size, 'planting')} would change`", "h('b.fd-head', { id: 'fdHead' }, ids.size ? `${plural(view.counted, 'planting')} would change`"),
 ("sooner is written as later", SE, "row.hi > 0 ? days + ' later' : row.lo < 0 ? days + ' sooner'", "row.hi > 0 ? days + ' sooner' : row.lo < 0 ? days + ' later'"),
 ("the worth after is not said", SE, "h('b', worthMoved ? `${money(view.worth[0])} → ${money(view.worth[1])}` : money(view.worth[0]))", "h('b', money(view.worth[0]))"),
 ("what a date was is not said", SE, "notes[f.key].textContent = moved ? `was ${FD.word(start.dates[f.key])}` : '';", "notes[f.key].textContent = '';"),
 ("“Back to the plan’s dates” only changes what the fields show", SE, "for (const key of FD.KEYS) { draft[key] = start.dates[key]; inputs[key].value = `${year}-${draft[key]}`; } draw();", "for (const key of FD.KEYS) { inputs[key].value = `${year}-${start.dates[key]}`; } draw();"),
 ("dates that cannot stand are passed over in silence", SE, "h('b.fd-head', { id: 'fdHead' }, 'These dates cannot stand')", "h('b.fd-head', { id: 'fdHead' }, 'Nothing is changed')"),
 ("no date is ever refused", AP, "const errors = FD.check(dates), changed = errors.length ? {} : FD.changed(state.engine, dates);", "const errors = [], changed = FD.changed(state.engine, dates);"),
 ("Apply leaves the window open", SE, "if (App.setFarmDates(draft)) close(); else draw();", "App.setFarmDates(draft); draw();"),
 ("the change is said with no Undo", AP, "toast(`${label} · ${moved}${fresh}${worth}`, { label: 'Undo', run: undo });", "toast(`${label} · ${moved}${fresh}${worth}`);"),
 ("the toast counts no harvest", AP, "const n = view.harvest.length, moved = n ?", "const n = 0, moved = n ?"),
 ("the change is two steps to undo", AP, "    const n = view.harvest.length, moved = n ?", "    commit(label, [{ kind: 'settings', before: state.plan.settings, after: { ...state.plan.settings } }], { unchecked: true });\n    const n = view.harvest.length, moved = n ?"),
 ("a stray line is written with the date", FD, *STRAY),
 ("the peak is cut off beside the new button", SE, "    if (foot.classList.contains('stacked') && peak.scrollWidth > peak.clientWidth + 1) { foot.classList.add('tight'); if (peak.scrollWidth > peak.clientWidth + 1) foot.classList.add('bare'); }\n", ""),
 ("the shortened peak says nothing when pointed at", SE, "    say.title = peak.share ? `Peak ${Math.round(peak.share * 100)}% of spaces planted, week of ${UI.day(peak.d)}` : '';\n", ""),
 ("Apply scrolls out of view under a long list", CSS, ".dialog.bk.fd .dialog-actions { position: sticky; bottom: -20px;", ".dialog.bk.fd .dialog-actions {"),
 ("days are said as 2027-05-20", SE, "const plainDays = text => String(text || '').replace(/\\b(\\d{4})-(\\d{2})-(\\d{2})\\b/g, (all, y, m, d) => `${UI.MONTHS[+m - 1]} ${+d}`);", "const plainDays = text => String(text || '');"),
 ("a field takes a day of another year", SE, "min: `${year}-01-01`, max: `${year}-12-31`, ", ""),
 ("several dates changed are named as if one", AP, ": `Change ${keys.length} of the farm’s dates`;", ": `Set ${FD.FIELDS.find(f => f.key === keys[0]).short} to ${FD.word(view.changed[keys[0]])}`;"),
 ("a yield that changes is not said", FD, *NOYIELD),
 ("plantings put outside the dates are said to be inside them", FD, *SWAP),
 ("the plantings outside the dates are not listed", SE, "          h('ul.fd-list.fd-why', { id: 'fdOutside' }, more(FD.byCrop(view.outside), 6, whyLine, n => `and ${plural(n, 'more crop')}`))] : null,", "          ] : null,"),
 ("the window does not say that nothing is flagged or moved", SE, ": the planner moves nothing and flags nothing. It would not offer", ". It would not offer"),
 ("the window opens on what was typed last time", SE, "const start = App.farmDates(), year = start.year, draft = { ...start.dates }, inputs = {}, notes = {};", "const start = App.farmDates(), year = start.year, draft = (root.fdLast = root.fdLast || { ...start.dates }), inputs = {}, notes = {};"),
 ("a description is missing from a date", FD, "does: 'The last day it offers anything a place outdoors.'", "does: ''"),
 ("the label is another build's", MN, "Preview " + LABEL, "Preview " + OTHER),
 ("the changed date is not marked", SE, "inputs[f.key].closest('.fd-row').dataset.changed = String(moved);", "inputs[f.key].closest('.fd-row').dataset.changed = 'false';"),
 ("the window says nothing of setting the date back", SE, "No planting is touched, so setting ${keys.length === 1 ? 'it' : 'them'} back puts everything back, and one undo does the same.", "No planting is touched."),
]
PHOTO = [
 ("the first part of the photo fix is taken back out", AP, *KEEP1),
 ("a browser left without its note does not mend itself", AP, "if (!hash || hash !== ref.sha256) return;", "if (true) return;"),
 ("any kept picture is taken for the plan's photo", AP, "if (!hash || hash !== ref.sha256) return;", "if (!hash) return;"),
]
if mode == "list": print(json.dumps({"page": len(PAGE), "photo": len(PHOTO)})); sys.exit(0)
faults = {"page": PAGE, "photo": PHOTO}[mode]
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
lo, hi = int(os.environ.get("FROM", "0")), int(os.environ.get("TO", str(len(faults))))
caught, missed, broken, tried = [], [], [], 0
for i, (name, rel, a, b) in [(-1, (None, None, None, None))] + list(enumerate(faults)):
    if name is not None and (i < lo or i >= hi): continue
    if name is None and not faults[lo:hi]: continue
    work = scratch / f"mut-season-{mode}"
    if work.exists(): shutil.rmtree(work)
    shutil.copytree(app, work)
    if name is not None:
        tried += 1
        text = (work / rel).read_text(encoding="utf-8")
        if text.count(a) != 1:
            broken.append(name); print(f"BROKEN  {name}  the text to change was found {text.count(a)} times", flush=True); continue
        (work / rel).write_text(text.replace(a, b), encoding="utf-8")
    if mode == "page":
        stdout, stderr = alone([sys.executable, "-I", str(tests / "season_check.py"), str(work), str(scratch / "mut-shots")], 400)
    else:
        stdout, stderr = alone([sys.executable, "-I", str(tests / "photo_keep_check.py"), str(work), str(scratch / "mut-shots"), str(repo)], 600)
    out = stdout.strip().split("\n")[-1] if stdout.strip() else ""
    try:
        d = json.loads(out); bad = [x["name"] if isinstance(x, dict) else str(x) for x in d.get("failed") or []]; ran = True
    except Exception:
        bad = ["no result: " + (stderr or stdout)[-200:]]; ran = False
    if name is None: already = unfaulted(bad if ran else [], ran); continue
    fails = len(bad) if ran else 0; bad = [x for x in bad if not ran or (already is not None and x not in already)]
    if bad and ran:
        caught.append(name); print(f"caught  {name}  ->  {len(bad)} failed, first: {str(bad[0])[:110]}", flush=True)
    else:
        missed.append(name); print(f"MISSED  {name}  {bad[:1] if bad or not fails else '(only what fails with no fault in it too)'}", flush=True)
print(json.dumps({"mode": mode, "faults": tried, "caught": len(caught), "missed": missed, "broken": broken}))
