"""Deliberate faults for the Forecast page (E3): its tab and title, "?" and its words, the line of figures, the table in amounts and
in dollars, its week and season totals, "Whole season", the popup's rows and tags, the list to send, the kept forecast and the call
by month. Each is put into a copy of the app folder, and a line of forecast_check.py that passed with no fault in it must fail.
usage: python3 -I mutate_forecast.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against forecast_check.py (about half a minute a fault).
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
HV, FC, UI, YC, CSS, IDX = "js/harvestview.js", "js/forecast.js", "js/ui.js", "js/yieldcard.js", "css/app.css", "index.html"
PAGE = [
 ("the tab still reads Harvest", IDX, 'aria-pressed="false" title="What the plan gives and earns, week by week, and over the season">Forecast</button>', 'aria-pressed="false" title="What the plan gives and earns, week by week, and over the season">Harvest</button>'),
 ("the page's paragraph stands on the page", HV, "h('div.fc-lead', { id: 'hvLead', hidden: true,", "h('div.fc-lead', { id: 'hvLead', hidden: false,"),
 ("\"?\" says DTM", HV, "' Days to harvest are the same in every month,", "' DTM is the same in every month,"),
 ("\"?\" names two patterns", HV, "h('br'), 'Clear: all of it on the day it is ready.', ", ""),
 ("the season figure is the week's", HV, "fig('season', 'Season', money(all.worth), worthSays,", "fig('season', 'Season', money(now.worth), worthSays,"),
 ("a dollar cell is the amount", HV, "const v = F.sum(series, c.i0, c.i1), text = cash$ ? cash(v) : qty(v),", "const v = F.sum(series, c.i0, c.i1), text = qty(v),"),
 ("dollars read what is picked, not what is sold", HV, "const seriesOf = (m, x) => (dollars() ? x.value :", "const seriesOf = (m, x) => (dollars() ? x.days :"),
 ("a crop's season in dollars is its amount", HV, "}, money(row.worth))\n", "}, money(row.total))\n"),
 ("a week's worth leaves out the last crop", HV, "c => cash(rows.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0)));", "c => cash(rows.slice(0, -1).reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0)));"),
 ("in dollars no kind has a total", HV, "if (cash$ ? part.length > 0 : g !== 'produce' && part.length > 1) {", "if (cash$ ? false : g !== 'produce' && part.length > 1) {"),
 ("the whole season leaves out its last week", HV, "if (fit) return F.periods(m, 'week', s.i0, s.i1);", "if (fit) return F.periods(m, 'week', s.i0, s.i1 - 7);"),
 ("the whole season does not fit", CSS, "table.hv.fit { width: 100%; table-layout: fixed; }", "table.hv.fit { width: 100%; }"),
 ("a narrow cell's figure spills out", HV, "if (over()) tbl.classList.add('bare');", "if (false) tbl.classList.add('bare');"),
 ("a fitted cell's full figure is rounded", HV, "title: row ? `${row.name}, ${colTitle(c)}: ${full}`", "title: row ? `${row.name}, ${colTitle(c)}: ${text}`"),
 ("the popup counts the plantings of the whole season", HV, "const lead = `${F.amount(total, row.unit, row.group)} ${picked ? 'picked' : 'to sell'} · ${num(list.length)} planting", "const lead = `${F.amount(total, row.unit, row.group)} ${picked ? 'picked' : 'to sell'} · ${num(row.plantings.length)} planting"),
 ("the popup's rows have no photograph", HV, "        root.LRFThumbs.el({ varietyId: x.p.varietyId, cropId: x.p.cropId, color: eng.cropColor(x.r.c), label: x.r.c.vname || x.r.c.name, size: 40 }),\n        h('span', h('b.row-name'", "        h('span', h('b.row-name'"),
 ("every planting is tagged On demand", HV, "tag('pattern', PATTERN[x.pattern] || PATTERN.spread,", "tag('pattern', PATTERN.spread,"),
 ("a variety's own window is not seen in the popup", YC, "return !owns(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && owns(v)) && !!b && !eng.isRack(b);", "return !owns(p) && !!b && !eng.isRack(b);"),
 ("no planting is tagged Own window", HV, "own ? tag('own', 'Own window',", "false ? tag('own', 'Own window',"),
 ("the list to send keeps a fraction of a thing counted", FC, "function sendShown(n, unit) { return counted(unit) ? (n > 0 ? Math.floor(n + 1e-6) : 0) : shown(n); }", "function sendShown(n, unit) { return shown(n); }"),
 ("the list to send says nothing for each", FC, "return `${fmt(v)} ${w || 'each'}`;", "return `${fmt(v)}${w ? ' ' + w : ''}`;"),
 ("the kept forecast is worked out afresh at every call", FC, "    if (!mine.has(key)) mine.set(key, build(eng, options));\n    return mine.get(key);", "    mine.set(key, build(eng, options));\n    return build(eng, options);"),
 ("the kept forecast is kept for the first engine and never again", FC, "    let mine = KEPT.get(eng);\n    if (!mine) { mine = new Map(); KEPT.set(eng, mine); }", "    let mine = KEPT.get(KEPT) || KEPT.get(eng);\n    if (!mine) { mine = new Map(); KEPT.set(eng, mine); KEPT.set(KEPT, mine); }"),
 ("by month leaves out December", FC, "for (let k = 0; k < 12; k++) months.push(", "for (let k = 0; k < 11; k++) months.push("),
 ("\"?\" is not beside the title", HV, "h('h2', { id: 'hvTitle', dataset: { hook: 'fc-title' } }, 'Forecast'), helpBtn, lead(m, marked)", "h('h2', { id: 'hvTitle', dataset: { hook: 'fc-title' } }, 'Forecast'), lead(m, marked)"),
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
copy = scratch / "mutant-forecast"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "forecast_check.py"), str(copy), str(scratch / "mutant-forecast-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
