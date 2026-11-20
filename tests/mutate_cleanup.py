"""Deliberate faults for preview 0.39 (the clean-up build): each puts back one thing the build put right, in a copy of the
app folder, and a named line of cleanup_check.py must fail.
usage: python3 -I mutate_cleanup.py <app-dir> <scratch-dir> <tests-dir> [page | list] [words…]
env: FROM=, TO= to run a part. Each fault takes about a minute. list: how many faults there are, and nothing else.
(The node mode ran cleanup_test.cjs, the proof of one past build. That proof is retired, tests/what_changed.cjs with the build’s file under tests/builds does its work, and the mode is taken out: its faults, a script changed or added that the build does not name, are in mutate_changed.py.)
Some faults here put the earlier version's name back on the page on purpose: a line of the check searches for it, and must fail.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests = [Path(x) for x in sys.argv[1:4]]
mode = sys.argv[4] if len(sys.argv) > 4 else 'page'; pick = [w.lower() for w in sys.argv[5:]]
LABEL = os.environ.get('LRF_LABEL') or '(LRF_LABEL is not set)'; OTHER = LABEL[:-1] + ('0' if LABEL[-1] != '0' else '1')   # the build's label, as tests/env.sh reads it from the page's own script, and one that is not it
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
PAGE = [
  # (what is put back, file, now, as it was, a word of the line that must fail)
  ("the Backup menu loads “a v7 backup”", 'index.html', '<b>Load a backup…</b>', '<b>Load a v7 backup…</b>', 'Backup menu'),
  ("a download is “a plan file the v7 planner can restore”", 'index.html', '<small>The plan as one file, to keep somewhere safe or load again</small>', '<small>A plan file the v7 planner can restore</small>', 'Backup menu'),
  ("the label says “Rebuild preview”", 'js/main.js', '`Preview ${(root.LRFBuilt', '`Rebuild preview ${(root.LRFBuilt', 'the build says'),
  ("the label is another build's", 'js/built.js', 'label: "' + LABEL + '",', 'label: "' + OTHER + '",', 'the build says'),   # the label is written in js/built.js (tools/shared.cjs)
  ("the Assumptions list speaks of the old planner", 'js/assume.js', 'Some plantings keep figures of their own, so', 'Some plantings keep figures from the old planner, so', 'names the planner'),
  ("a tooltip on the Assumptions list speaks of the old planner", 'js/assume.js', "'Plantings that carry nursery weeks of their own that differ", "'Plantings that carry nursery weeks from the old planner that differ", 'names the planner'),
  ("the review window has an “Old copy”", 'js/assume.js', "copy: 'Copied value' }", "copy: 'Old copy' }", 'old copy'),
  ("the last figure of a row is pushed to the end of its line", 'css/app.css', ".stat { flex: 1 1 92px; min-width: 0; background", ".stats > .stat:last-child { margin-left: auto; flex: 0 0 92px; }\n.stat { flex: 1 1 92px; min-width: 0; background", 'grey block'),
  ("the rows of figures are a grid again, the last one sent to the end", 'css/app.css', ".stats { display: flex; flex-wrap: wrap; gap: 1px;", ".stats > .stat:last-child { grid-column-end: -1; }\n.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 1px;", 'grey block'),
  ("the Harvest table opens 320 px in, wherever that falls", 'js/harvestview.js', "scroller.scrollLeft = Math.max(0, scroller.scrollLeft + first.getBoundingClientRect().left - edge);", "scroller.scrollLeft = Math.max(0, now.offsetLeft - 320 - 3 * now.offsetWidth);", 'whole column'),
  ("the Harvest table opens at its start (seen at 1280, where the season does not fit)", 'js/harvestview.js', "scroller.scrollLeft = Math.max(0, scroller.scrollLeft + first.getBoundingClientRect().left - edge);", "scroller.scrollLeft = 0;", 'opens scrolled'),
  ("Forecast says “a week at a time, or all at once”", 'js/harvestview.js', "'Gradually: a week’s picking, every week of its harvest window.', h('br'), 'Clear: all of it on the day it is ready.', h('br'), 'On demand: spread evenly over its harvest window.'", "'Evenly over the days it is picked, a week at a time, or all at once.'", 'three words'),
  ("a sheltered crate's tick says it again in the old sentence (L3)", 'js/bench.js', "They take no bench room.`,", "They stand on the floor and take no bench room.`,", 'old sentences with a link'),
  ("the frost words have no ground of their own", 'css/app.css', ".season-frost b { font-weight: inherit; background: var(--surface); padding: 0 2px; }", ".season-frost b { font-weight: inherit; padding: 0 2px; }", 'frost marks'),
  ("the frost words are bare text again", 'js/season.js', "h('i'), h('b', label)));", "h('i'), label));", 'frost marks'),
  ("the empty day's line does not end", 'js/sowview.js', "h('p', 'Nothing is planned for today.')", "h('p', 'Nothing is planned for today')", 'empty day'),
  ("ticks are the browser's blue", 'css/app.css', 'input[type="checkbox"], input[type="radio"] { accent-color: var(--ink); }', 'input[type="checkbox"], input[type="radio"] { }', 'own ink'),
  ("a variety's days are “Not stated: as the crop”", 'js/seeds.js', "['unspecified', 'As the crop']", "['unspecified', 'Not stated: as the crop']", 'As the crop'),
  ("the variety panel's headings are in the bold face", 'css/app.css', ".sd-review h3 { font: 500 var(--type-11) var(--mono);", ".sd-review h3 { font: 700 13px var(--body);", 'headings'),
  ("the importer's window is “from a supplier page”", 'js/seeds.js', "openDialog('Add a variety from a link',", "openDialog('Add a variety from a supplier page',", 'Add from a link'),
  ("a crop sown in place counts from “sowing”", 'js/assume.js', "sown: ['direct seeding',", "sown: ['sowing',", "own words"),
  # the same sentence stands in index.html too, but the list writes its own over it as it is drawn: a fault there shows nowhere
  ("the list's first line says “where its days start”", 'js/assume.js', "Each row says what its days are counted from. Each number", "Each row says where its days start. Each number", 'first line'),
  ("the order sheet's window names the old planner", 'js/seeds.js', "openDialog('Add a variety from a link',", "openDialog('Add a variety from a link (as the old planner did)',", 'names the planner'),
  # the words, from one glossary (0.63): each puts back one note or hover it took away, or one term it put in
  ("To settle's paragraph stands under its head again", 'js/panels.js', "h('div.sec-head', h('h3', `To settle · ${total}`), why));", "h('div.sec-head', h('h3', `To settle · ${total}`), why), h('p.help', 'Ground booked twice, or plantings longer than their bed. They came in with the plan, or follow from a change to the assumptions. Each has a fix in one click; the map will not let you add to them.'));", "To settle's note"),
  ("the Assumptions “?” gives no terms", 'js/assume.js', "() => WORDS[ui.mode] || []", "() => []", "each half's terms"),
  ("the Assumptions “?” lists the crop list's rows as controls again", 'js/assume.js', "() => document.querySelector('#assumeView .as-tools'), () => WORDS", "() => $('assumeView'), () => WORDS", "each half's terms"),
  ("the Picked head's hover is long again", 'js/assume.js', "'The harvest pattern. Gradually: a week’s picking, every week. Clear: all of it the day it is ready. On demand: a total, spread evenly.'", "'How the harvest comes in. Gradually: picked week by week, and the yield is a week’s picking. Clear: the yield is a total, all of it taken the day it is ready. On demand: the yield is a total, held and taken evenly over the harvest days.'", "long hovers"),
  ("What fits has no “?”", 'js/ahead.js', "fits.length ? fitsHelp() : null)", "null)", "What fits"),
  ("one of the Nursery's rules loses its “?”", 'js/bench.js', "{ label: 'What these rules change', hook: 'bench-help', card: { hook: 'bench-help-card' } }", "{ label: 'What these rules change' }", "Nursery's hardening-off"),
  ("the unheated benches' “?” says nothing", 'js/bench.js', "['On the unheated benches', 'From its first day through its last, a crop’s plug trays and pots stand on the unheated benches once they have had their days under heat to come up. Tower seedlings stay under heat.']", "['On the unheated benches', '']", "Nursery's hardening-off"),
  # defined terms behind "?" (0.64): each puts back one definition that stood, or takes the term off the front of a card
  ("Personal use is defined under the switch again", 'js/panels.js', "      : use.by === 'default' ? null\n", "      : use.by === 'default' ? 'Personal use is sown, picked and counted like any other planting, and left out of revenue and out of the list you send.'\n", "a planting's panel"),
  ("Grown for has no “?” in a planting's panel", 'js/panels.js', "UI.help(null, null, USE_WORDS, { label: 'What Grown for means', hook: 'use-help', card: { hook: 'use-help-card' } })", "null", "a planting's panel"),
  ("Edit layout defines Personal use under a bed's box again", 'js/mapedit.js', "Plantings follow their bed unless one says otherwise.`)));", "Plantings follow their bed unless one says otherwise. Personal use is left out of revenue and out of the list you send.`)));", "Edit layout"),
  ("To settle's card no longer leads with its term", 'js/panels.js', "[['To settle', 'Ground booked twice", "[['', 'Ground booked twice", "To settle's note"),
  ("What fits' card leads with another word", 'js/ahead.js', "[['What fits', 'A crop that goes in whole", "[['Fits', 'A crop that goes in whole", "What fits"),
  ("the yield card's first picking says DTM again", 'js/yieldcard.js', "dataset: { hook: 'card-first-unit' } }, oneStart ? 'days' : after(t))", "dataset: { hook: 'card-first-unit' } }, oneStart ? 'DTM' : after(t))", "letters DTM"),
]
if mode == 'list': print(json.dumps({'page': len(PAGE)})); sys.exit(0)
def copy():
    dst = scratch / 'fault'
    if dst.exists(): shutil.rmtree(dst)
    shutil.copytree(app, dst); return dst
def run_page(dst):
    out = alone([sys.executable, '-I', str(tests / 'cleanup_check.py'), str(dst), str(scratch / 'fault-shots')], 420)[0]
    i = out.rfind('{"passed"')
    try: return json.loads(out[i:]) if i >= 0 else {'failed': ['NO RESULT'], 'of': 0}
    except Exception: return {'failed': ['NO RESULT'], 'of': 0}
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
lines = lambda got: [f if isinstance(f, str) else f.get('name', '') for f in got.get('failed', [])]
faults = PAGE
lo, hi = int(os.environ.get('FROM', 0)), int(os.environ.get('TO', len(faults)))
caught, missed, broken, tried = [], [], [], 0
chosen = lambda n, what: lo <= n < hi and (not pick or any(w in what.lower() for w in pick))
if any(chosen(n, f[0]) for n, f in enumerate(faults)): names = lines(run_page(copy())); already = unfaulted([f for f in names if f != 'NO RESULT'], 'NO RESULT' not in names)
for n, (what, rel, now, was, word) in enumerate(faults):
    if not chosen(n, what): continue
    dst = copy(); tried += 1
    p = dst / rel; s = p.read_text(encoding='utf-8')
    if s.count(now) != 1: broken.append(what); print(f'BROKEN {n}: {what} -> the text to change is there {s.count(now)} times', flush=True); continue
    p.write_text(s.replace(now, was), encoding='utf-8')
    got = run_page(dst)
    names = lines(got)
    hit = [f for f in names if word.lower() in f.lower() and already is not None and f not in already]
    (caught if hit else missed).append(what)
    print(('caught ' if hit else 'MISSED ') + f'{n}: {what} -> ' + (hit[0][:110] if hit else f'failed lines: {names[:4]}'), flush=True)
print(json.dumps({'mode': mode, 'faults': tried, 'caught': len(caught), 'missed': missed, 'broken': broken}, ensure_ascii=False))
