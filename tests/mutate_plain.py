"""Deliberate faults for preview 0.30: each is put into a copy, and a named check must fail.
usage: python3 -I mutate_plain.py <app> <scratch> <tests-dir> <repo> [page | worker | list] [words…]     env FROM=, TO= to run a part
page: against plain_check.py (half a minute each). worker: against tools/sync_worker_test.mjs and sync_client_test.mjs, on a copy of the repo's tools and worker (seconds each). list: how many faults there are of each kind, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests, repo = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "page"; words = [w.lower() for w in sys.argv[6:]]
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
AS, SV, SE, SY = "js/assume.js", "js/sowview.js", "js/seeds.js", "js/sync.js"
PAGE = [
 ("two weeks lists one", SV, "const span = phone ? 1 : ui.span, until", "const span = 1, until"),
 ("the range runs a week too far", SV, "until = E.d2s(E.addDays(d(now), 7 * span - 1)), inSpan = l => l.week >= now && l.week <= until, stretch", "until = E.d2s(E.addDays(d(now), 7 * span + 6)), inSpan = l => l.week >= now && l.week <= until, stretch"),
 ("the sheet prints the week whatever is listed", SV, "clear(host); host.append(sheet(fig, now, span));", "clear(host); host.append(sheet(fig, now));"),
 ("the printed sheet's own range is always a week", SV, "sheet: () => sheet(figures(), T.monday(E.d2s(App.state.date)), isPhone() ? 1 : ui.span),", "sheet: () => sheet(figures(), T.monday(E.d2s(App.state.date)), 1),"),
 ("a phone is offered the range", SV, "        phone ? null : h('div.seg.wk-span'", "        false ? null : h('div.seg.wk-span'"),
 ("the view still calls its work jobs", SV, "stat('Other tasks',", "stat('Other jobs',"),
 ("Gradually is the total held on demand", AS, "const PATTERN = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' };", "const PATTERN = { spread: 'Gradually', once: 'Clear', weekly: 'On demand' };"),
 ("the step still says how it is picked in the old words", AS, "`${c.name}: ${value === 'unset' ? 'picked as before' : PATTERN_SAY[value]}`", "`${c.name}: picked ${value === 'unset' ? 'as before' : value}`"),
 ("the column keeps its old name", "index.html", ">Days counted from</th>", ">Days start at</th>"),
 ("seeding in trays is still called sowing", AS, "const START = { transplant: 'Transplanting', seed: 'Seeding in trays', direct: 'Direct seeding' };", "const START = { transplant: 'Transplanting', seed: 'Sowing', direct: 'Direct seeding' };"),
 ("the one press moves what would change a date too", AS, "const made = App.auditStudy(), rows = made.rows, choices = Object.fromEntries(rows.map(r => [r.key, r.choice]));\n      let view", "const made = App.auditStudy(), rows = made.rows, choices = Object.fromEntries(rows.map(r => [r.key, r.take ? 'take' : 'follow']));\n      let view"),
 ("the one press does it without asking", AS, "      if (!ok) return false;\n      return !!(await App.auditApply(rows, choices));", "      return !!(await App.auditApply(rows, choices));"),
 ("the one press never checks that nothing changes", AS, "const quiet = v => !v.harvest && !v.sowing && !v.yields.length && !v.ground.length && !v.fresh.length && !v.crops.length && Math.abs(v.worth[1] - v.worth[0]) < 0.005;", "const quiet = v => true;"),
 ("the count kind by kind is open from the start", AS, "h('details.au-more', { id: 'asAuditMore' },", "h('details.au-more', { id: 'asAuditMore', open: true },"),
 ("the window lists every group again", AS, "shown = () => (view.all ? rows : rows.filter(differs)),", "shown = () => rows,"),
 ("the window opens by kind of figure", AS, "const auView = { by: 'crop', all: false };", "const auView = { by: 'kind', all: false };"),
 ("the crops in the window are in no order", AS, "for (const [title, mine] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {", "for (const [title, mine] of [...groups].reverse()) {"),
 ("the tick that shows the rest does nothing", AS, "onchange: e => { view.all = e.target.checked; fill(); } }), h('span', `Also show", "onchange: e => { view.all = e.target.checked; } }), h('span', `Also show"),
 ("Link reader is back on the Seeds bar", "index.html", '">Add from a link</button>\n', '">Add from a link</button>\n              <button type="button" class="btn">Link reader…</button>\n'),
 ("the older sync service is taken as able to read links", SE, "return !c ? 'none' : c.v >= 2 ? 'cloud' : 'cloud-old'; }", "return !c ? 'none' : 'cloud'; }"),
 ("Cloud sync is used though his own service is set", SE, "function linkHow() { const own = ownService(); if (Reader.serviceBase(own.base) && own.key.trim()) return 'own'; const c", "function linkHow() { const own = ownService(); if (false) return 'own'; const c"),
 ("the reader is handed his own (empty) service, not the cloud's", SE, "return how === 'cloud' ? { base: c.base, key: c.key } : ownService(); }", "return ownService(); }"),
 ("the fetch service of his own cannot be reached any more", SE, "h('button.linkish', { type: 'button', id: 'sdSettings', onclick: () => openSettings() },", "h('button.linkish', { type: 'button', id: 'sdSettings' },"),
]
WORKER = [
 ("a supplier page is read for anyone", "worker/lrf-plan-sync.js", "      const left = await tokenLeft(env, viaKey ? 'Bearer ' + viaKey : request.headers.get('authorization'), now);\n      if (!left) return json(401, { error: 'signin' }, origin);", "      const left = url.pathname === '/fetch' ? 1e9 : await tokenLeft(env, viaKey ? 'Bearer ' + viaKey : request.headers.get('authorization'), now);\n      if (!left) return json(401, { error: 'signin' }, origin);"),
 ("the reader's header opens everything", "worker/lrf-plan-sync.js", "const viaKey = url.pathname === '/fetch' && !request.headers.get('authorization') ? request.headers.get('x-lrf-key') : null;", "const viaKey = !request.headers.get('authorization') ? request.headers.get('x-lrf-key') : null;"),
 ("any site is fetched", "worker/lrf-plan-sync.js", "if (!image && !onList(u, sites)) return { status: 403,", "if (false) return { status: 403,"),
 ("a plain http address is fetched", "worker/lrf-plan-sync.js", "if (u.protocol !== 'https:' || u.username", "if (u.username"),
 ("a picture is handed back as a page", "worker/lrf-plan-sync.js", "if (image ? !type.startsWith('image/') : !/(text\\/html|application\\/xhtml|application\\/json|text\\/plain)/.test(type)) return { status: 415,", "if (false) return { status: 415,"),
 ("the final address is not said", "worker/lrf-plan-sync.js", "'content-type': result.type, 'x-lrf-final-url': result.final } });", "'content-type': result.type } });"),
 ("the service still says it is version 1", "worker/lrf-plan-sync.js", "const VERSION = 2;", "const VERSION = 1;"),
 ("extra sites are ignored", "worker/lrf-plan-sync.js", "return [...SITES, ...extra];", "return [...SITES];"),
 ("the browser may not send the reader's header", "worker/lrf-plan-sync.js", "x-lrf-base, x-lrf-key, x-lrf-meta,", "x-lrf-base, x-lrf-meta,"),
 ("the client hands the reader its passphrase-less token to nobody", "js/sync.js", "const linkService = () => (configured() && cfg.token ? { base: cfg.url, key: cfg.token, v: cfg.v || 0 } : null);", "const linkService = () => null;"),
 ("the client never notes the service's version", "js/sync.js", "if (v && v !== cfg.v) keep({ v }); };", "};"),
 ("a device that left still hands out its sign-in", "js/sync.js", "const linkService = () => (configured() && cfg.token ?", "const linkService = () => (cfg.token || true ?"),
]
if mode == "list": print(json.dumps({"worker": len(WORKER), "page": len(PAGE)})); sys.exit(0)
faults = PAGE if mode == "page" else WORKER
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
copy = scratch / "mutant"; caught, missed, broken = [], [], []
for name, rel, old, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    if mode == "page":
        shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    else:
        copy.mkdir(parents=True); shutil.copytree(repo / "tools", copy / "tools"); shutil.copytree(repo / "worker", copy / "worker"); shutil.copytree(app / "js", copy / "js")
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(old) != 1: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(old)} times", flush=True); continue
        f.write_text(s.replace(old, new), encoding="utf-8")
    if mode == "page":
        out = alone([sys.executable, "-I", str(tests / "plain_check.py"), str(copy), str(scratch / "mutant-shots")], 300, env={**os.environ, "STOP_AT_FAIL": "1"})[0]
        try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
        except Exception: names = []; ran = False
    else:
        out = subprocess.run(["node", "tools/sync_worker_test.mjs"], cwd=copy, capture_output=True, text=True, timeout=120).stdout + subprocess.run(["node", "tools/sync_client_test.mjs", str(copy / "js")], cwd=copy, capture_output=True, text=True, timeout=120).stdout
        names = [l[5:85] for l in out.splitlines() if l.startswith("FAIL ") and "the test ran to its end" not in l]; ran = len([l for l in out.splitlines() if l.endswith(" passed") and l.split()[1:2] == ["of"]]) == 2 and "the test ran to its end" not in out   # both tests ended with their count
    if name is None and mode != "page" and names:   # these two print a failing line with its figures after its name, so the lines of two runs cannot be matched by name
        print("with no fault in it the tests already fail: nothing can be shown to be caught: " + "; ".join(names)[:500], flush=True); already = None; continue
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:170] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}))
