"""Deliberate faults for the Timeline showing the bed the card is showing (#88), and an opening's way back to its bed: the row's
orange edge, the ring on the planting open in the bed's season, the Timeline told when the card opens a row, the row brought into view
(on going to the Timeline, and for a pick made elsewhere) up or down only and only when hidden, and the way back at the opening's head.
Each is put into a copy of the app folder, and a line of tlpick_check.py that passed with no fault in it must fail.
usage: python3 -I mutate_tlpick.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against tlpick_check.py (about forty seconds a fault).
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
CD, TL, AH, CSS = "js/card.js", "js/timeline.js", "js/ahead.js", "css/app.css"
PAGE = [
 ("the picked bed's row has no orange along it", CSS, ".tl-row.sel::after { content: ''; position: absolute; inset: 0; border-block: 2px solid var(--flag); pointer-events: none; z-index: 5; }\n", ""),
 ("the planting open in the bed's season is not ringed", TL, "bar: (C && C.openRow && C.openRow()) || null, bed: sel.id };", "bar: null, bed: sel.id };"),
 ("the card does not tell the Timeline it opened a row", CD, "        if (root.LRFTimeline && root.LRFTimeline.showPick) root.LRFTimeline.showPick();   // the Timeline rings the row opened (#88)\n", ""),
 ("going to the Timeline, what the card opened while it was away is not shown", TL, "      if (dirty) render(); else markSel();", "      if (dirty) render();"),
 ("going to the Timeline does not bring the picked bed into view", TL, "        showRow();   // what the card holds, brought into view if it is hidden (#88)\n", ""),
 ("a pick made elsewhere is not brought into view", TL, "      // picked somewhere else (the card, a list): its row is brought into view if it was hidden; a click here is on a row in view (#88)\n      showRow();\n", ""),
 ("a row that shows only in part is moved all the same", TL, "    if (box.bottom > top && box.top < bottom) return;", "    if (box.top >= top && box.bottom <= bottom) return;"),
 ("bringing a row into view moves the date across too", TL, "    scroll.scrollTop += box.top - top - Math.max(0, (bottom - top - box.height) / 3);", "    scroll.scrollTop += box.top - top - Math.max(0, (bottom - top - box.height) / 3); scroll.scrollLeft += 48;"),
 ("a planting picked is not ringed", TL, "return { row: null, bar: sel.id, bed: p ? p.bedId : null }; }", "return { row: null, bar: null, bed: p ? p.bedId : null }; }"),
 ("the opening's way back says Everything in again", AH, "h('span', { 'aria-hidden': 'true' }, '‹'), App.bedLabel(o.bed)),", "`Everything in ${App.bedLabel(o.bed)}`),"),
 ("the opening's way back is not first in its head", AH, "      h('header.insp-head', h('button.link.insp-back',", "      h('header.insp-head', h('p.eyebrow', 'Opening'), h('button.link.insp-back',"),
 ("the way back from the bed's card goes to the bed in the side panel", AH, "onclick: () => (sel.fromBedSeason && root.LRFCard ? root.LRFCard.backToBed(o.bed.id) : App.select({ type: 'bed', id: o.bed.id })) }", "onclick: () => App.select({ type: 'bed', id: o.bed.id, fromBedSeason: true }) }"),
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
copy = scratch / "mutant-tlpick"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "tlpick_check.py"), str(copy), str(scratch / "mutant-tlpick-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
