"""Deliberate faults for Loose ends, the one list for what needs the grower (DESIGN.md, rule 4): each is put into a copy of the app
folder, and a line of loose_check.py that passed with no fault in it must fail.
usage: python3 -I mutate_loose.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against loose_check.py (about half a minute a fault).
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
PN, AS, SE, CSS = "js/panels.js", "js/assume.js", "js/seeds.js", "css/app.css"
LISTEN = "    document.addEventListener('pointerdown', looseAway, true); document.addEventListener('keydown', looseKey, true);\n  }\n  function drawSettle"
PAGE = [
 ("what can wait is counted with what needs the grower", PN, "n + (r.kind === 'needs' ? r.n : 0)", "n + r.n"),
 ("the count is in ink, not in orange", CSS, "color: #fff; background: var(--flag-deep); border-radius: var(--corner-pill); padding: 0 var(--space-8); min-width: 20px;", "color: #fff; background: var(--ink); border-radius: var(--corner-pill); padding: 0 var(--space-8); min-width: 20px;"),
 ("what can wait is listed first", PN, "KINDS = [['needs', 'Needs you'], ['minute', 'When you have a minute']];", "KINDS = [['minute', 'When you have a minute'], ['needs', 'Needs you']];"),
 ("ground booked twice is listed with what can wait", PN, "{ key: 'ground', kind: 'needs',", "{ key: 'ground', kind: 'minute',"),
 ("Escape leaves the list open", PN, "if (e.key === 'Escape' && looseBox) { closeLoose(); $('settleBadge').focus(); }", "if (e.key === 'Escape' && looseBox) { $('settleBadge').focus(); }"),
 ("a click elsewhere leaves the list open", PN, LISTEN, LISTEN.replace("document.addEventListener('pointerdown', looseAway, true); ", "")),
 ("the list is too narrow for its rows", CSS, "width: min(480px, calc(100vw - 24px)); overflow: auto;", "width: min(300px, calc(100vw - 24px)); overflow: auto;"),
 ("seed no row can count is listed with what can wait, and not counted", SE, "{ key: 'lots', kind: 'needs',", "{ key: 'lots', kind: 'minute',"),
 ("seed no row can count stands in the Seeds panel with nothing picked", SE, "onOrder ? h('span', h('b', num(onOrder)), ' on order') : null),\n", "onOrder ? h('span', h('b', num(onOrder)), ' on order') : null), m.unlisted.length ? unlistedBox(m) : null,\n"),
 ("seed on order is no filter of the Seeds list", SE, "['short', 'Short of seed'], ['ordered', 'On order'], ", "['short', 'Short of seed'], "),
 ("the filter for seed on order lists what is short of seed", SE, "(id === 'ordered' && !!r && r.onOrder > 0)", "(id === 'ordered' && !!r && r.short > 0)"),
 ("the row for supplier days opens Seeds with no filter pressed", SE, "App.setView('seeds'); ui.filter = 'open'; ui.tab = 'list'; select(null);", "App.setView('seeds'); ui.tab = 'list'; select(null);"),
 ("“See what differs…” leaves the sheet open under the review window", AS, "onclick: () => { differDlg.close(); openAudit(); } }, 'See what differs…')", "onclick: () => { openAudit(); } }, 'See what differs…')"),
 ("the sheet of what differs has two dark buttons", AS, "h('button.btn.small', { type: 'button', id: 'asTidy',", "h('button.btn.small.primary', { type: 'button', id: 'asTidy',"),
 ("the sheet of published guidance is asked for on Yield and price, where it has nothing to show", AS, "    ui.mode = 'days'; render();\n    if (!$('asHints').hidden && !guideDlg.open) guideDlg.showModal();", "    render();\n    if (!$('asHints').hidden && !guideDlg.open) guideDlg.showModal();"),
 ("the notice of what differs stands on the Assumptions page again", AS, "    document.body.append(differDlg, guideDlg);", "    $('assumeView').querySelector('.as-tools').before(h('section.as-audit', h('b', 'Plantings that differ from your list'))); document.body.append(differDlg, guideDlg);"),
 ("the line of figures is gone from the Assumptions list", CSS, ".view-assume .as-head #asCount { display: block;", ".view-assume .as-head #asCount { display: none;"),
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
copy = scratch / "mutant-loose"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "loose_check.py"), str(copy), str(scratch / "mutant-loose-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
