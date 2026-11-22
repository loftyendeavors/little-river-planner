"""Deliberate faults for L3, part 2, the plain controls (#91): links that go somewhere in one look and buttons that do something, a
planting's panel with "⋯" at its head, one answer for a drop, the card's link and Undo, Days · Weeks · Months as one switch on the
Timeline and the Forecast, the Timeline's filter pills, the Nursery's two ticks, the Seeds heading's two buttons, a plant's yield box
and its tip, and words that read at 4.5:1. Each is put into a copy of the app folder, and a line of controls_check.py that passed with
no fault in it must fail.
usage: python3 -I mutate_controls.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against controls_check.py (about forty seconds a fault).
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
AP, PN, CD, BN, SD, TL, HV, YC, IX, CSS = "js/app.js", "js/panels.js", "js/card.js", "js/bench.js", "js/seeds.js", "js/timeline.js", "js/harvestview.js", "js/yieldcard.js", "index.html", "css/app.css"
PAGE = [
 # a planting's panel
 ("the panel has no “⋯” at its head", PN, "        h('button.icon-btn.insp-more', { type: 'button', 'aria-label': 'More', 'aria-haspopup': 'menu', title: 'More', dataset: { hook: 'panel-more' }, onclick: e => root.LRFCard.menu(plantingMore(p, bed, r), e.currentTarget) }, '⋯'),\n", ""),
 ("Send to To place stands in the panel again", PN, "otherwise the next free one in ${eng.gardenOf(bed).name}.`),", "otherwise the next free one in ${eng.gardenOf(bed).name}.`), h('button.btn', { type: 'button', onclick: () => App.sendToWait(p.id) }, 'Send to To place'),"),
 ("the panel's menu holds Remove planting only", PN, "        ['wait', 'Send to To place', () => App.sendToWait(p.id)],\n", ""),
 ("Send to To place in the panel's menu does nothing", PN, "['wait', 'Send to To place', () => App.sendToWait(p.id)]", "['wait', 'Send to To place', () => {}]"),
 ("Remove planting in the panel's menu does nothing", PN, "['remove', 'Remove planting', () => App.removePlantings([p.id]), null, 'bad']]", "['remove', 'Remove planting', () => {}, null, 'bad']]"),
 ("the bed's name at the panel's head is drawn as a button", PN, "h('button.link', { type: 'button', dataset: fromBedSeason ? { hook: 'bed-planting-back' } : { hook: 'panel-bed' },", "h('button.btn.small', { type: 'button', dataset: fromBedSeason ? { hook: 'bed-planting-back' } : { hook: 'panel-bed' },"),
 ("the bed's name at the panel's head goes nowhere", PN, "onclick: () => fromBedSeason ? root.LRFCard.backToBed(bed.id) : App.select({ type: 'bed', id: bed.id }) }, App.bedLabel(bed)),", "onclick: () => {} }, App.bedLabel(bed)),"),
 ("Several varieties… is underlined text again", PN, "h('button.btn.quiet.small', { type: 'button', id: 'fSeveral'", "h('button.link', { type: 'button', id: 'fSeveral'"),
 ("Plan a longer series… is a bounded button", PN, "h('button.btn.quiet.small', { type: 'button', id: 'fSeriesLink'", "h('button.btn.small', { type: 'button', id: 'fSeriesLink'"),
 ("record is underlined text again", PN, "h('button.btn.small.job-tick', { type: 'button', dataset: { job: 'tick', hook: 'job-record' },", "h('button.link.job-tick', { type: 'button', dataset: { job: 'tick', hook: 'job-record' },"),
 ("the Saved line's Undo is underlined text again", PN, "last.canUndo ? h('button.btn.small', { type: 'button', dataset: { saved: 'undo', hook: 'panel-saved-undo' }", "last.canUndo ? h('button.link', { type: 'button', dataset: { saved: 'undo', hook: 'panel-saved-undo' }"),
 ("the Saved line's Undo makes the line taller", CSS, ".insp-saved .btn { margin: -6px 0 -6px var(--space-8); }", ".insp-saved .btn { margin: 0 0 0 var(--space-8); }"),
 ("the Saved line's Undo takes nothing back", PN, "dataset: { saved: 'undo', hook: 'panel-saved-undo' }, onclick: () => App.undo() }", "dataset: { saved: 'undo', hook: 'panel-saved-undo' }, onclick: () => {} }"),
 # one answer for a drop
 ("a drop is answered twice again, by the page and by the panel", AP, "    if (!commit(label, ops, { page: true })) return null;\n    select({ type: 'planting', id: p.id });", "    if (!commit(label, ops)) return null;\n    select({ type: 'planting', id: p.id });"),
 ("Codex on #97: a drop that picks another planting is said in passing too", PN, "if (!last || last.kind !== 'saved' || last.page || last.at !== lastSeen", "if (!last || last.kind !== 'saved' || last.at !== lastSeen"),
 ("the panel takes no word from a drop's step", PN, "const fresh = last && !last.page && Date.now()", "const fresh = last && Date.now()"),
 # the card
 ("Planting details on the card is a bounded button", CD, "h('div.card-foot', h('button.link', { type: 'button', dataset: { hook: 'card-full' }", "h('div.card-foot', h('button.btn.small', { type: 'button', dataset: { hook: 'card-full' }"),
 ("the way from the card's nursery row to Planting details is a quiet button", CD, "h('button.link', { type: 'button', dataset: { hook: 'card-nursery-full' }", "h('button.btn.quiet.small', { type: 'button', dataset: { hook: 'card-nursery-full' }"),
 ("the card's Undo is underlined text again", CD, "last.canUndo ? h('button.btn.small', { type: 'button', dataset: { hook: 'card-undo' }", "last.canUndo ? h('button.link', { type: 'button', dataset: { hook: 'card-undo' }"),
 # Days · Weeks · Months, and the pills
 ("the Timeline reads Months first again", IX, '            <button type="button" data-tl-zoom="days" data-hook="tl-by-choice" aria-pressed="false">Days</button>\n            <button type="button" data-tl-zoom="weeks" data-hook="tl-by-choice" aria-pressed="false">Weeks</button>\n            <button type="button" data-tl-zoom="months" data-hook="tl-by-choice" aria-pressed="true" title="The whole year">Months</button>\n',
  '            <button type="button" data-tl-zoom="months" data-hook="tl-by-choice" aria-pressed="true" title="The whole year">Months</button>\n            <button type="button" data-tl-zoom="weeks" data-hook="tl-by-choice" aria-pressed="false">Weeks</button>\n            <button type="button" data-tl-zoom="days" data-hook="tl-by-choice" aria-pressed="false">Days</button>\n'),
 ("the Timeline's switch is 28 high again", CSS, ".tl-zoom .seg { flex: none; }", ".tl-zoom .seg { flex: none; } .tl-zoom .seg button { min-height: 26px; }"),
 ("the Timeline's choices are separate buttons again", IX, '<div class="seg tl-by" role="group" aria-label="Show by" data-hook="tl-by">', '<div class="tl-by" role="group" aria-label="Show by" data-hook="tl-by">'),
 ("the Forecast reads Weeks before Days", HV, "seg('day', 'Days'), seg('week', 'Weeks'), seg('month', 'Months'),", "seg('week', 'Weeks'), seg('day', 'Days'), seg('month', 'Months'),"),
 ("+ no longer steps the Timeline's scale", TL, "$('tlZoomIn').addEventListener('click', () => setScale(ppd * 1.5));", "$('tlZoomIn').addEventListener('click', () => setScale(ppd * 1.25));"),
 ("the Timeline's growing spaces are not pills", TL, "host.append(h('button.chip', { type: 'button', dataset: { tlFilter: id, hook: 'tl-filter' }", "host.append(h('button', { type: 'button', dataset: { tlFilter: id, hook: 'tl-filter' }"),
 ("the Timeline's pills are 28 high", CSS, ".tl-filters .chip { white-space: nowrap; }", ".tl-filters .chip { white-space: nowrap; min-height: 28px; }"),
 ("Towers shows every kind of space", TL, "onclick: () => setFilter(id) }", "onclick: () => setFilter('all') }"),
 # Nursery › Set-up
 ("the Nursery's ticks say nothing of what they come to", BN, "      h('span', h('b', label), h('small', does)));", "      h('span', h('b', label)));"),
 ("the trays' tick sets the opposite", BN, "on => App.setOwn('trays', on ? null : 'variety',", "on => App.setOwn('trays', on ? 'variety' : null,"),
 ("the crates' tick changes nothing", BN, "on => App.setOwn('crates', on ? null : 'bench',", "on => App.setOwn('crates', null,"),
 # Seeds
 ("the heading's buttons stand at rest", CSS, ".sd-crop .sd-crop-act { margin-block: -6px; opacity: 0;", ".sd-crop .sd-crop-act { margin-block: -6px; opacity: 1;"),
 ("the heading's buttons never come under the pointer", CSS, ".sd-crop:hover .sd-crop-act, .sd-crop:focus-within .sd-crop-act { opacity: 1; }", ".sd-crop:focus-within .sd-crop-act { opacity: 1; }"),
 ("the heading's buttons never come with the keyboard", CSS, ".sd-crop:hover .sd-crop-act, .sd-crop:focus-within .sd-crop-act { opacity: 1; }", ".sd-crop:hover .sd-crop-act { opacity: 1; }"),
 ("Edit crop folds the heading as well", SD, "if (e.target.closest('.sd-crop-act')) return;", "if (e.target.closest('.link')) return;"),
 ("Edit crop is underlined text again", SD, "h('button.btn.small.sd-crop-act', { type: 'button', dataset: { hook: 'seeds-edit-crop' }", "h('button.link.sd-crop-act', { type: 'button', dataset: { hook: 'seeds-edit-crop' }"),
 ("Add a variety opens nothing", SD, "dataset: { hook: 'seeds-add-variety' }, onclick: () => openVariety(null, g.id) }", "dataset: { hook: 'seeds-add-variety' }, onclick: () => {} }"),
 # a plant's yield box
 ("a plant's box says a spacing its figure does not keep", YC, "const showsBasis = bx && (bx.bed || bx.how) && !unkept,", "const showsBasis = bx && (bx.bed || bx.how),"),
 ("with no figure the tip names no spacing", YC, "`No yield is set for this crop: type what ${of} gives${weekly ? ' each week' : ' in all'}.`", "'No yield is set for this crop.'"),
 # words that read
 ("“your day” reads faint again", CSS, "letter-spacing: 0.04em; color: color-mix(in srgb, var(--flag-deep) 85%, var(--ink)); }   /* reads at 4.5:1 at its size (L3) */", "letter-spacing: 0.04em; color: var(--flag); }"),
 ("the counts on the pills read faint again", CSS, ".chip small { font: 500 var(--type-11) var(--mono); opacity: 0.85;", ".chip small { font: 500 var(--type-11) var(--mono); opacity: 0.7;"),
 ("the frost words read faint again", CSS, "font: 500 var(--type-11) var(--mono); color: color-mix(in srgb, var(--frost) 70%, var(--ink)); white-space: nowrap;", "font: 500 var(--type-11) var(--mono); color: var(--frost); white-space: nowrap;"),
 ("the Forecast's week reads faint again", CSS, ".hv thead th.now { color: color-mix(in srgb, var(--flag-deep) 85%, var(--ink));", ".hv thead th.now { color: var(--flag);"),
 ("the planning week's tag reads faint again", CSS, "letter-spacing: 0.05em; color: color-mix(in srgb, var(--flag-deep) 85%, var(--ink)); }   /* reads at 4.5:1 at its size (L3) */", "letter-spacing: 0.05em; color: var(--flag); }"),
 ("the hint's green reads faint again", CSS, "color: color-mix(in srgb, var(--good) 85%, var(--ink)); border-radius: var(--corner-pill);", "color: var(--good); border-radius: var(--corner-pill);"),
 ("the counts in a switch read faint again", CSS, ".seg button small { font: 500 var(--type-11) var(--mono); opacity: 0.85;", ".seg button small { font: 500 var(--type-11) var(--mono); opacity: 0.65;"),
 # one look for a link
 ("a link is drawn at 400 again", CSS, "button.link, .link { padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; font: 600 var(--type-13) var(--body);", "button.link, .link { padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; font: 400 var(--type-13) var(--body);"),
 ("a link is not underlined", CSS, "color: var(--ink-2); text-align: left; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }", "color: var(--ink-2); text-align: left; text-decoration: none; text-underline-offset: 2px; cursor: pointer; }"),
 ("Show the other N is underlined text again", PN, "h('button.btn.quiet.small.fix-more', { type: 'button', dataset: { hook: 'settle-more' }", "h('button.link.fix-more', { type: 'button', dataset: { hook: 'settle-more' }"),
 ("Bench room, in Nursery is a bold link of its own", CSS, ".bn-line .link { margin-left: auto; }", ".bn-line .link { margin-left: auto; font-weight: 700; }"),
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
copy = scratch / "mutant-controls"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "controls_check.py"), str(copy), str(scratch / "mutant-controls-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
