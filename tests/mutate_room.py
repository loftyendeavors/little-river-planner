"""Deliberate faults for the Timeline and the library (redesign build 4): room for a crop, a shut garden's band, To place, an
opening's words clear of the nursery line. Each is put into a copy of the app folder, and a line of room_check.py that passed with
no fault in it must fail.
usage: python3 -I mutate_room.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against room_check.py (about twenty seconds a fault).
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
TL, PN, SR, CSS = "js/timeline.js", "js/panels.js", "js/series.js", "css/app.css"
PAGE = [
 ("a carried crop is drawn nowhere", TL, "    if (!S || !armed || !armed.cropId || armed.plantingId || armed.waitingId) return null;\n    const crop = eng.crop(armed.cropId);", "    return null;\n    const crop = eng.crop(armed.cropId);"),
 ("an opening is lit whether or not the crop fits it", TL, "      if (t.ok) fits.set(o.id, { o, t });", "      if (t.r) fits.set(o.id, { o, t });"),
 ("the planting is drawn on the last day it could go in, not the first", TL, "const t = fit.t, r = t.r, through = t.through, from = eng.occupancyFrom(t.p, r);", "const t = fit.t, r = t.r, through = t.through, from = t.latest || eng.occupancyFrom(t.p, r);"),
 ("a click plants it on the last day it could go in, not the first", TL, "App.place(App.state.armed, fit.o.bed.id, E.s2d(fit.t.p.date));", "App.place(App.state.armed, fit.o.bed.id, fit.t.latest || E.s2d(fit.t.p.date));"),
 ("a click on a lit opening selects the opening and plants nothing", TL, "      if (roomEl) { plantRoom(roomEl.dataset.room); return; }\n", ""),
 ("an opening's words are laid over the nursery line of the planting after it", TL, "        if (f0 > a && s0 < a + n) clear = Math.min(clear, Math.max(0, s0 - a));", "        if (f0 > a && s0 < a + n) clear = Math.min(clear, n);"),
 ("the nursery line is drawn over the top of its bar again", CSS, ".tl-bar .ph-nursery { top: 17px; height: 2px;", ".tl-bar .ph-nursery { top: -3px; height: 3px;"),
 ("every other bar stays at full strength", CSS, ".tl-body.room .tl-bar:not(.tl-room) { opacity: 0.5; }\n", ""),
 ("a lit opening has a green dashed edge", CSS, ".tl-open.fit { border: 1px solid var(--flag);", ".tl-open.fit { border: 1.5px dashed var(--good);"),
 ("the words stand past the end of the opening", TL, "      const beside = (end - z) * ppd - 14, under = (end - a) * ppd - 10;", "      const beside = (end - z) * ppd + 400, under = (end - a) * ppd + 400;"),
 ("the line in the tools counts the farm twice", TL, "const farm = room.fits.size, name", "const farm = room.fits.size * 2, name"),
 ("the line stands beside the key, and the tools change height", CSS, ".tl-tools:has(.tl-room-line:not([hidden])) .tl-key { display: none; }\n", ""),
 ("the hint never shows", TL, "    hint.hidden = false;\n    const at = bar.getBoundingClientRect()", "    hint.hidden = true;\n    const at = bar.getBoundingClientRect()"),
 ("the hint leaves out when it is picked", TL, "      h('p', goes, ' · Pick ', B(r.first), ' to ', B(r.last), free),", "      h('p', goes, free),"),
 ("x leaves the crop carried", TL, "onclick: () => App.arm(null) }, '×')", "onclick: () => {} }, '×')"),
 ("a garden that is shut has no band", TL, "        if (shut) { if (s === 'field' || s === 'cover') shutBand(head, eng, group.spaces); continue; }", "        if (shut) continue;"),
 ("the band counts every week as empty", TL, "'--p': share > 0 ? Math.round(6 + 50 * share) + '%' : '0%'", "'--p': '0%'"),
 ("the band marks no week the crop could start", TL, "band.append(h('b', { style: at(s0, s1 - s0 + 1), dataset: { hook: 'band-start' } }));", "void s1;"),
 ("To place carries no count", SR, "    if (count) { count.hidden = !n;", "    if (count) { count.hidden = true;"),
 ("the count in the header no longer opens To place", SR, "      if (root.LRFPanels) root.LRFPanels.setScope('wait');\n", ""),
 ("To place lists what waits with small pictures", SR, "label: c.name, size: 40, cls: 'key' }),\n        h('div.wait-what'", "label: c.name, size: 24, cls: 'key' }),\n        h('div.wait-what'"),
 ("To place lists nothing", PN, "    if (lib.scope === 'wait' && root.LRFSeries) { root.LRFSeries.fillWaiting(clear($('libList')), lib.query);", "    if (lib.scope === 'wait' && root.LRFSeries) { clear($('libList'));"),
 ("a waiting row picked turns light under the pointer, its light words lost", CSS, ".wait-row:not(.armed):hover { background: var(--surface);", ".wait-row:hover { background: var(--surface);"),
 ("a crop picked in the library is marked in orange, not in ink", CSS, ".lib-row.armed { background: var(--ink); border-color: var(--ink); color: var(--surface); }", ".lib-row.armed { background: var(--flag-soft); border-color: var(--flag); }"),
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
copy = scratch / "mutant-room"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "room_check.py"), str(copy), str(scratch / "mutant-room-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
