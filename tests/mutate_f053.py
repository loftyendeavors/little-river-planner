"""Deliberate faults for the small fixes of 0.53 (the build in view and what changed, the Map's "?", the list of varieties that
keeps its place, resizing said plainly): each is put into a copy of the app folder, and a line of fixes_053_check.py that passed
with no fault in it must fail.
usage: python3 -I mutate_f053.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against fixes_053_check.py (about half a minute a fault).
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
PN, MN, CH, BT, UI, MP, ME, CSS = "js/panels.js", "js/main.js", "js/changes.js", "js/built.js", "js/ui.js", "js/map.js", "js/mapedit.js", "css/app.css"
PAGE = [
 ("the header says another build's label", MN, "root.LRFChanges.init(BUILD_NOTE.replace(' · ', ''));", "root.LRFChanges.init('Preview 0.01');"),
 ("the chip is not named for what it opens", CH, "chip.setAttribute('aria-label', `Preview ${running}: what changed`);", ""),
 ("at narrow widths the build's number stands beside the year and takes width from the header", CSS, "  .build-chip { grid-column: 3; grid-row: 2; justify-self: start; align-self: start; min-height: 0; border: 0; padding: 0; line-height: 1.2; }\n", "  .build-chip { grid-column: 4; grid-row: 1 / 3; }\n"),
 ("at narrow widths the chip keeps the word “Preview”", CSS, "  .build-chip span { display: none; }\n", ""),
 ("above 1400 the chip has no edge", CSS, "min-height: var(--control-in); border: 1px solid var(--line); border-radius: var(--corner-pill); background: none; padding: 0 var(--space-8); font: 500 var(--type-11) var(--mono);", "min-height: var(--control-in); border: 0; border-radius: var(--corner-pill); background: none; padding: 0 var(--space-8); font: 500 var(--type-11) var(--mono);"),
 ("the builds are listed oldest first", CH, "BUILDS.map(b => h('section.wc-build',", "BUILDS.slice().reverse().map(b => h('section.wc-build',"),
 ("the newest entry is not this build's", BT, "    builds: [\n", "    builds: [\n      { label: '99.0', on: '2026-01-01', did: 'A build that was never made, put first in the list.', steps: ['Nothing to try.'] },\n"),
 ("no build is said to be the one running", CH, "b.label === running ? `${when(b.on)} · this build` : when(b.on)", "when(b.on)"),
 ("a build has four things to try", CH, "h('ol', b.steps.map(step => h('li', { dataset: { hook: 'changes-step' } }, step)))", "h('ol', [...b.steps, 'And one more.'].map(step => h('li', { dataset: { hook: 'changes-step' } }, step)))"),
 ("the sheet has a × as well as Done", CH, "      h('h2', 'What changed'),\n", "      h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: close }, '×'), h('h2', 'What changed'),\n"),
 ("the list does not scroll: the sheet runs off the window", CSS, ".dialog.wc { width: min(520px, calc(100vw - 32px)); max-width: none; max-height: calc(100vh - 40px); }", ".dialog.wc { width: min(520px, calc(100vw - 32px)); max-width: none; max-height: none; }"),
 ("nothing is marked “New”", CH, "    const last = seen();\n", "    const last = '999';\n"),
 ("a build stays “New” after the list has been opened", CH, "    if (known && later(known, last)) keep(known);\n", ""),
 ("every build is “New” whatever was opened before", CH, "    const last = seen();\n", "    const last = '';\n"),
 ("Done leaves the sheet open", CH, "id: 'changesDone', onclick: close }, 'Done')", "id: 'changesDone' }, 'Done')"),
 ("Escape leaves the sheet open", CH, "oncancel: e => { e.preventDefault(); close(); } },", "oncancel: e => { e.preventDefault(); } },"),
 ("a newer build that is ready is not said on the chip", CH, "if (chip) { chip.dataset.newer = '1'; chip.title = ", "if (chip) { chip.title = "),
 ("a newer build that is ready is not said in the sheet", CH, "      newer ? h('p.wc-newer',", "      false ? h('p.wc-newer',"),
 ("“Reload” is a second dark button", CH, "h('button.btn', { type: 'button', onclick: () => root.location.reload() }, 'Reload')", "h('button.btn.primary', { type: 'button', onclick: () => root.location.reload() }, 'Reload')"),
 ("on a phone the chip is shown and the header takes two lines", CSS, "body.phone .brand-sub, body.phone .build-chip, body.phone .bn { display: none !important; }", "body.phone .brand-sub, body.phone .bn { display: none !important; } body.phone .build-chip { min-width: 96px; }"),
 ("“On the map” is listed in the side panel again", PN, "    renderCleanup(host);\n  }\n", "    renderCleanup(host);\n    add(host, h('section.insp-section.howto', h('h3', 'On the map'), h('ul.how', h('li', h('b', 'Plant'), 'Drag a crop from the library onto a bed.'))));\n  }\n"),
 ("the Map's “?” is the first of the tools, not the last", MP, "    tools.append(UI.help(null, () => tools, () => [", "    tools.prepend(UI.help(null, () => tools, () => ["),
 ("the Map's card is one column", CSS, ".hint.cols dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--space-8) var(--space-16); }", ".hint.cols dl { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-8) var(--space-16); }"),
 ("the Map's card does not say how to copy", MP, "      ['Copy', 'Hold Alt while dragging.'],\n", ""),
 ("the Map's card has no way to a succession with no crop picked", MP, "h('button.btn.quiet.small', { type: 'button', id: 'ovSuccession', dataset: { hook: 'map-help-succession' }, onclick: () => App.openAhead({ mode: 'succession' }) }, 'Plan a succession…')", "'Plan one from the library.'"),
 ("“plan one now” leaves the card open over the tool", UI, "      box.addEventListener('click', e => { if (e.target.closest('button')) close(); });\n", ""),
 ("Escape leaves the Map's card open", UI, "const key = e => { if (e.key === 'Escape' && box) { close(); btn.focus(); } };", "const key = e => { if (e.key === 'Escape' && box) { btn.focus(); } };"),
 ("with “?” among them the map's tools run into the scale", CSS, "  .map-tools .tool-btn { padding-inline: var(--space-8); }\n", ""),
 ("a tick sends the list of varieties back to its top", PN, "      now.scrollTop = at;\n", ""),
 ("a tick takes the keyboard from the box that was ticked", PN, "      if (tick) tick.focus({ preventScroll: true });\n", ""),
 ("a bed too small for its grips does not say so", ME, "(first.L * z < 30 ? ' · zoom in to drag an end' : first.L * z < 46 ? ' · zoom in to drag a side' : '')", "(first.L * z < 3 ? ' · zoom in to drag an end' : first.L * z < 46 ? ' · zoom in to drag a side' : '')"),
 ("a bed whose sides cannot be dragged does not say so", ME, "first.L * z < 46 ? ' · zoom in to drag a side' : '')", "first.L * z < 31 ? ' · zoom in to drag a side' : '')"),
 ("a bed with all its grips still says to zoom in", ME, "first.L * z < 46 ? ' · zoom in to drag a side' : '')", "first.L * z < 4600 ? ' · zoom in to drag a side' : '')"),
 ("the box that fits a garden to the photo has its old name", ME, "field('Fit to the photo (%)',", "field('Drawn at (% of true size)',"),
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
copy = scratch / "mutant-f053"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "fixes_053_check.py"), str(copy), str(scratch / "mutant-f053-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
