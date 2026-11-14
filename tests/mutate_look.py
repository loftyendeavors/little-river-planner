"""Deliberate faults for preview 0.40 (the look and controls, stage A: the map's look): each puts one fault into a copy of the
app folder, and a named line of look_a_test.cjs (node) or look_a_check.py (page) must fail.
usage: python3 -I mutate_look.py <app-dir> <scratch-dir> <tests-dir> <plan.json> [node | page | list] [words…]
env: FROM=, TO= to run a part. node: seconds a fault. page: about a minute a fault. list: how many faults there are, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests, plan = [Path(x) for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else 'node'; pick = [w.lower() for w in sys.argv[6:]]
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

# (what goes wrong, file, now, with the fault in, a word of the line that must fail)
NODE = [
  ("two groups are nearly one colour", 'js/library.js', '{"id": "herbs", "name": "Herbs", "color": "#32459b"}', '{"id": "herbs", "name": "Herbs", "color": "#7046b0"}', 'plainly different'),
  ("a group is told from the others by ordinary sight only", 'js/library.js', '{"id": "brassicas", "name": "Brassicas", "color": "#2a8a57"}', '{"id": "brassicas", "name": "Brassicas", "color": "#966340"}', 'colour-blind'),
  ("a bed being picked is hardly deeper", 'js/map.js', "const PICK = 0.3,", "const PICK = 0.08,", 'can be told from one growing'),
  ("a group is too pale for a white bed", 'js/library.js', '{"id": "micro", "name": "Microgreens", "color": "#e6dc9c"}', '{"id": "micro", "name": "Microgreens", "color": "#f4f1dc"}', 'stands off an empty bed'),
  ("a group is named twice", 'js/library.js', '{"id": "other", "name": "Other crops", "color": "#7c8279"}', '{"id": "herbs", "name": "Other crops", "color": "#7c8279"}', 'twelve groups'),
  ("a family is sent to a group that is not there", 'js/library.js', '"Rosaceae": "berries"}', '"Rosaceae": "fruit"}', 'every family the library sends'),
  ("a flower takes its family’s colour", 'js/engine.js', "kind === 'flower' ? 'flowers' : (look.byFamily", "(look.byFamily", 'every crop falls in a group'),
  ("every crop is one colour", 'js/engine.js', "      return colorGroup(c).color;", "      return '#8a8f7a';", 'every crop falls in a group'),
  ("a colour given to the crop itself is passed over", 'js/engine.js', "      if (c.color) return c.color;\n      return colorGroup(c).color;", "      return colorGroup(c).color;", 'given to the crop itself'),
  ("what the plan says of a crop is not heard", 'js/engine.js', "recordUnit(c), (plan.lrfNext || {}).groups)", "recordUnit(c), null)", 'what the plan says'),
  ("a crop of a family with no group takes the first group", 'js/engine.js', "(look.byFamily || {})[c.family] || 'other');", "(look.byFamily || {})[c.family] || 'nightshades');", 'family has no group'),
]
PAGE = [
  ("the photo is greyed and darkened again", 'css/app.css', ".on-photo .plate { fill: rgba(214, 223, 217, 0.96);", "#map.on-photo #mapPhoto { filter: saturate(0.7) brightness(0.9); }\n.on-photo .plate { fill: rgba(214, 223, 217, 0.96);", 'photo keeps its own colour'),
  ("the plates are dark glass again", 'css/app.css', ".on-photo .plate { fill: rgba(214, 223, 217, 0.96);", ".on-photo .plate { fill: rgba(8, 19, 14, 0.5);", 'grey-green plate'),
  ("a plate has no shadow", 'css/app.css', " filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.38)); }", " }", 'grey-green plate'),
  ("an empty bed is see-through again", 'css/app.css', ".on-photo .bed-base, .on-photo .hatch-bg { fill: #fbfcfb; }", ".on-photo .bed-base, .on-photo .hatch-bg { fill: rgba(255, 255, 255, 0.13); }", 'empty bed is white'),
  ("a bed being picked is no deeper than one growing", 'js/map.js', "const fill = ripe ? shade(color, PICK) : color,", "const fill = color,", 'bed still growing'),
  ("the deeper shade is on the bed still growing", 'js/map.js', "const fill = ripe ? shade(color, PICK) : color,", "const fill = ripe ? color : shade(color, PICK),", 'bed still growing'),
  ("the row lines are the bed’s own colour", 'js/map.js', "stroke: shade(fill, ROWS) })); }", "stroke: fill })); }", 'row lines'),
  ("every crop is one colour", 'js/engine.js', "      return colorGroup(c).color;", "      return '#8a8f7a';", 'bed still growing'),
  ("a space is counted for every planting of a crop in it", 'js/map.js', "counts.set(cropId, set = new Set()); set.add(bedId); };", "counts.set(cropId, set = new Set()); set.add(bedId + '|' + set.size); };", 'counts once for a group'),
  ("a space is counted for every crop of a group in it", 'js/map.js', "      for (const bedId of beds) row.beds.add(bedId);   // a space counts once for a group, however many of its crops it grows", "      for (const bedId of beds) row.beds.add(bedId + '|' + id);", 'counts once for a group'),
  ("a group’s mark in the line is not its colour", 'js/map.js', "h('i', { style: { background: g.color } }), h('span', g.name), h('b', n)));", "h('i', { style: { background: '#888888' } }), h('span', g.name), h('b', n)));", 'in its colour'),
  ("the groups run from fewest spaces to most", 'js/map.js', "|| b.beds.size - a.beds.size ||", "|| a.beds.size - b.beds.size ||", 'most spaces to the one in fewest'),
  ("the button goes when every group fits", 'js/map.js', "    more.textContent = hidden ? `+${hidden}` : 'Key';", "    more.hidden = !hidden; more.textContent = hidden ? `+${hidden}` : 'Key';", 'always there'),
  ("the key stays shut when the line is opened", 'css/app.css', ".map-bar.open .map-key { display: flex; }", ".map-bar.open .map-key { display: none; }", 'key to how beds are drawn'),
  ("in the key harvest is the paler of the two", 'css/app.css', ".map-key .k-pick { background: var(--ink); }", ".map-key .k-pick { background: var(--line); }", 'key to how beds are drawn'),
  ("a click on a group shows nothing alone", 'js/map.js', "!highlightGroup || crops.some(c => App.state.engine.colorGroup(c).id === highlightGroup);", "true;", 'click on a group shows only'),
  ("the crops of the group shown alone are not listed", 'js/map.js', "      if (on) for (const { c, n: m } of crops) {", "      if (false) for (const { c, n: m } of crops) {", 'click on a group shows only'),
  ("a click on a crop of the group still shows the whole group", 'js/map.js', "highlightCrop ? crops.some(c => c.id === highlightCrop) : ", "", 'one of those crops'),
  ("a group shown alone is lost from the line when nothing of it is in the ground", 'js/map.js', "if (g) rowOf(g); else highlightGroup = highlightCrop = null; }", "}", 'still in the line'),
  ("a band of the whole season is the deeper shade", 'js/map.js', "attrs = { fill: color, class: 'bed-fill pick season'", "attrs = { fill: shade(color, PICK), class: 'bed-fill pick season'", 'whole-season picture'),
  ("the selected planting’s outline has no white casing", 'css/app.css', " filter: drop-shadow(0 0 1.2px #fff) drop-shadow(0 0 1.2px #fff) drop-shadow(0 0 1.2px #fff) drop-shadow(0 0 2.5px rgba(19, 36, 28, 0.6)); }", " }", 'outline on the map'),
  ("the selected bar has no white line", 'css/app.css', ".tl-bar.sel { box-shadow: 0 0 0 1.5px #fff, 0 0 0 4px var(--flag),", ".tl-bar.sel { box-shadow: 0 0 0 4px var(--flag),", 'Timeline the selected bar'),
  ("a Timeline bar is not its group’s colour", 'js/timeline.js', "'--crop': x.color, color: UI.inkOn(x.color)", "'--crop': '#777777', color: UI.inkOn(x.color)", 'every bar on the Timeline'),
  ("ground that cannot take the crop fades to 30% again", 'css/app.css', ".bed.drop-ok .bed-edge { stroke: var(--ink); stroke-width: 2.5px; }", ".bed.drop-blocked { opacity: 0.3; }\n.bed.drop-ok .bed-edge { stroke: var(--ink); stroke-width: 2.5px; }", 'steps back to 60%'),
  ("the beds that step back nearly vanish", 'css/app.css', ":not(.drop-target) .bed-rows { opacity: 0.6; }", ":not(.drop-target) .bed-rows { opacity: 0.38; }", 'steps back to 60%'),
  ("the beds that are not free do not step back", 'css/app.css', ":not(.drop-target) .bed-rows { opacity: 0.6; }", ":not(.drop-target) .bed-rows { opacity: 1; }", 'steps back to 60%'),
  ("every bed that is not free is dashed in orange again", 'css/app.css', ".bed.drop-ok .bed-edge { stroke: var(--ink); stroke-width: 2.5px; }", ".bed.drop-split .bed-edge, .bed.drop-partial .bed-edge, .bed.drop-swap .bed-edge { stroke: var(--flag); stroke-width: 2px; stroke-dasharray: 2 3; }\n.bed.drop-ok .bed-edge { stroke: var(--ink); stroke-width: 2.5px; }", 'outlined in orange or dashed'),
  ("free ground is a thin orange outline", 'css/app.css', ".bed.drop-ok .bed-edge { stroke: var(--ink); stroke-width: 2.5px; }", ".bed.drop-ok .bed-edge { stroke: var(--flag); stroke-width: 2px; }", 'free ground has a firm dark outline'),
  ("free ground is not white", 'css/app.css', ".on-photo .bed.drop-ok .bed-base, .bed.drop-ok .bed-base { fill: #fff; }", ".on-photo .bed.drop-ok .bed-base, .bed.drop-ok .bed-base { fill: color-mix(in srgb, var(--flag) 26%, transparent); }", 'free ground has a firm dark outline'),
  ("the bed under the pointer has a thin outline", 'css/app.css', ".bed.drop-target .bed-edge, .on-photo .bed.drop-target .bed-edge { stroke: var(--flag); stroke-width: 4px; }", ".bed.drop-target .bed-edge, .on-photo .bed.drop-target .bed-edge { stroke: var(--flag); stroke-width: 2px; }", 'under the pointer'),
  ("the bed under the pointer steps back with the rest", 'css/app.css', "#map.dropping .bed:not(.drop-ok):not(.drop-target) .bed-fill, #map.dropping .bed:not(.drop-ok):not(.drop-target) .bed-rows { opacity: 0.6; }", "#map.dropping .bed:not(.drop-ok) .bed-fill, #map.dropping .bed:not(.drop-ok) .bed-rows { opacity: 0.6; }", 'under the pointer'),
  ("small grey text is the fainter grey again", 'css/app.css', "  --muted: #586a60;", "  --muted: #66786e;", 'small grey text'),
  ("white text stands on the bright orange", 'css/app.css', ".toast-action { border: 0; background: var(--flag-deep);", ".toast-action { border: 0; background: var(--flag);", 'white text never stands'),
  ("the deeper orange is the bright one", 'css/app.css', "  --flag-deep: #d04510;", "  --flag-deep: #e4521b;", 'white text never stands'),
  ("the mark that opens a crop’s varieties is nearly unseen at rest", 'css/app.css', ".lib-more { border: 0; background: none; color: var(--muted);", ".lib-more { border: 0; background: none; color: var(--line);", 'mark that opens'),
  ("a letter on a tile is nearly the tile’s colour", 'css/app.css', "color: color-mix(in srgb, var(--thumb-c, var(--muted)) 50%, var(--ink)); }", "color: color-mix(in srgb, var(--thumb-c, var(--muted)) 30%, var(--raised)); }", 'letter that stands off'),
]
if mode == 'list': print(json.dumps({'node': len(NODE), 'page': len(PAGE)})); sys.exit(0)
def copy():
    dst = scratch / 'fault'
    if dst.exists(): shutil.rmtree(dst)
    shutil.copytree(app, dst); return dst
def result(out):
    i = out.rfind('{"passed"')
    try: return json.loads(out[i:]) if i >= 0 else {'failed': ['NO RESULT'], 'of': 0}
    except Exception: return {'failed': ['NO RESULT'], 'of': 0}
def run(dst):
    if mode == 'node': return result(alone(['node', str(tests / 'look_a_test.cjs'), str(dst), str(plan)], 120)[0])
    return result(alone([sys.executable, '-I', str(tests / 'look_a_check.py'), str(dst), str(scratch / 'fault-shots')], 420)[0])
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print('with no fault in it the check gives no result: nothing can be shown to be caught', flush=True); return None
    if names: print('with no fault in it the check already fails, so these lines catch nothing: ' + '; '.join(names)[:700], flush=True)
    return set(names)
lines = lambda got: [f if isinstance(f, str) else f.get('name', '') for f in got.get('failed', [])]
faults = NODE if mode == 'node' else PAGE
lo, hi = int(os.environ.get('FROM', 0)), int(os.environ.get('TO', len(faults)))
caught, missed, broken, tried = [], [], [], 0
chosen = lambda n, what: lo <= n < hi and (not pick or any(w in what.lower() for w in pick))
already = set()
if any(chosen(n, f[0]) for n, f in enumerate(faults)): names = lines(run(copy())); already = unfaulted([f for f in names if f != 'NO RESULT'], 'NO RESULT' not in names)
for n, (what, rel, now, was, word) in enumerate(faults):
    if not chosen(n, what): continue
    dst = copy(); tried += 1
    p = dst / rel; s = p.read_text(encoding='utf-8')
    if s.count(now) != 1: broken.append(what); print(f'BROKEN {n}: {what} -> the text to change is there {s.count(now)} times', flush=True); continue
    p.write_text(s.replace(now, was), encoding='utf-8')
    names = lines(run(dst))
    hit = [f for f in names if word.lower() in f.lower() and already is not None and f not in already]
    (caught if hit else missed).append(what)
    print(('caught ' if hit else 'MISSED ') + f'{n}: {what} -> ' + (hit[0][:110] if hit else f'failed lines: {names[:4]}'), flush=True)
print(json.dumps({'mode': mode, 'faults': tried, 'caught': len(caught), 'missed': missed, 'broken': broken}, ensure_ascii=False))
