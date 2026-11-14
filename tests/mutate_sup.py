"""Deliberate faults for the supplies build: each must fail a named line of sup_check.py (page) or of importer_check.py (importer).
usage: python3 -I mutate_sup.py <app> <scratch> <tests-dir> [page | importer | list] [words…]     env FROM=, TO= to run a part
The app folder is copied; the copy is broken, checked and thrown away. list: how many faults there are of each kind, and nothing else.
(The node mode ran sup_test.cjs, the proof of one past build. That proof is retired, tests/what_changed.cjs with tests/this-build.json does its work, and the mode is taken out.)
"""
import json, os, shutil, signal, subprocess, sys, time
app, scratch, tests = sys.argv[1:4]; which = sys.argv[4] if len(sys.argv) > 4 else "page"; words = [w.lower() for w in sys.argv[5:]]
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
 ("quarts in the heading", "js/bench.js", "'Mix each, cu ft'), h('th', 'Mix, cu ft')", "'Mix each, qt'), h('th', 'Mix, cu ft')"),
 ("no cases shown", "js/bench.js", "r.pack ? h('small.bn-pack', `${plural(r.pack.n, 'case')} of ${r.pack.size}`) : null", "null"),
 ("the round figure shown as his", "js/bench.js", "cell(r, 'mix', r.mixOwn ? String(r.mixEach) : '',", "cell(r, 'mix', r.mixEach != null ? String(r.mixEach) : '',"),
 ("no pocket picker", "js/bench.js", "if (r.pockets) {", "if (r.pockets && false) {"),
 ("crates not said", "js/bench.js", "m.crates.n ? h('small', `Crates take", "false ? h('small', `Crates take"),
 ("a label too long for its place", "css/app.css", ".bn-supplies td.bn-how { white-space: normal;", ".bn-supplies td.bn-how { white-space: nowrap; min-width: 1400px;"),
]
IMP = [
 ("the copied-text route shown before any failure", "js/seeds.js", "h('section.sd-fallback', { id: 'sdFallback', hidden: true,", "h('section.sd-fallback', { id: 'sdFallback', hidden: false,"),
 ("the copied-text route never shown after one", "js/seeds.js", "if (f.fallback && fallback.hidden) { fallback.hidden = false;", "if (false) { fallback.hidden = false;"),
 ("a fetch service of his own on the opening window", "js/seeds.js", "h('div.sd-row', readBtn, button('Cancel', () => d.close())), failed, fallback);", "h('div.sd-row', readBtn, button('Cancel', () => d.close())), h('button.linkish', { type: 'button' }, 'Use a fetch service of your own instead…'), failed, fallback);"),
 ("the old paste box back", "js/seeds.js", "fld('Product link', url, hint), h('div.sd-row', readBtn,", "fld('Product link', url, hint), h('details', h('summary', 'Paste the page instead')), h('div.sd-row', readBtn,"),
 # not a fault to plant: with the gate before the read taken out, the reader refuses an empty service itself and the same words are said; no request can be made either way
 ("not signed in said as anything else", "js/seeds.js", "if (/refused the key/i.test(msg)) return", "if (/refused the keyX/i.test(msg)) return"),
 ("no connection said as anything else", "js/seeds.js", "if (/fetch service did not answer/i.test(msg)) return", "if (/fetch service did not answerX/i.test(msg)) return"),
 ("the supplier's refusal said as anything else", "js/seeds.js", "if (/blocked the reader|verification page/i.test(msg)) return", "if (/blocked the readerX/i.test(msg)) return"),
 ("a site off the list not named", "js/seeds.js", "if (/is not one of the supplier sites/i.test(msg)) return", "if (/is not one of the supplier sitesX/i.test(msg)) return"),
 ("a mistyped address offered the copied text", "js/seeds.js", "return { step: 'address', fallback: false, text: 'That is not a complete web address.", "return { step: 'address', fallback: true, text: 'That is not a complete web address."),
 ("an empty box offered the copied text", "js/seeds.js", "return { step: 'address', fallback: false, text: 'Paste the product page’s address first.' };", "return { step: 'address', fallback: true, text: 'Paste the product page’s address first.' };"),
 ("copied text read with no name", "js/seeds.js", "if (from === 'paste' && !name && !source) {", "if (false) {"),
 ("page source asked for a name", "js/seeds.js", "source = /<(?:html|body|main|script)\\b/i.test(pasteText.value);", "source = false;"),
 ("the reason under what to do instead", "js/seeds.js", "button('Cancel', () => d.close())), failed, fallback);", "button('Cancel', () => d.close())), fallback, failed);"),
 ("the paste box left without the focus", "js/seeds.js", "pasteText.focus({ preventScroll: true });", ""),
 ("the old sentence about pasting kept under the box", "js/seeds.js", "'Links are read through Cloud sync once this device is connected (Backup, Cloud sync…).';", "'Links are read through Cloud sync once this device is connected (Backup, Cloud sync…). Until then, paste the page below.';"),
 ("the fetch service of his own cannot be opened", "js/seeds.js", "h('button.linkish', { type: 'button', id: 'sdSettings', onclick: () => openSettings() },", "h('button.linkish', { type: 'button', id: 'sdSettings' },"),
]
if which == "list": print(json.dumps({"page": len(PAGE), "importer": len(IMP)})); sys.exit(0)
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
already = None
def run(name, f, a, b, cmd):
    global already
    work = os.path.join(scratch, "mut-app"); shutil.rmtree(work, ignore_errors=True); shutil.copytree(app, work)
    if name is not None:
        p = os.path.join(work, f); s = open(p, encoding="utf-8").read()
        if s.count(a) != 1: print(f"BROKEN  {name} -> the text to change is there {s.count(a)} times", flush=True); return None
        open(p, "w", encoding="utf-8").write(s.replace(a, b))
    out = alone([c.replace("@APP", work) for c in cmd], 600)[0].strip().split("\n")[-1]
    try: d = json.loads(out); failed = d.get("failed") or []; ran = True
    except Exception: failed = ["no result: " + out[-200:]]; ran = False
    names = [x["name"] if isinstance(x, dict) else x for x in failed]
    real = [n for n in names if not n.startswith("no result") and n != "the test ran to its end"]   # a named line, not only a stop
    if name is None: already = unfaulted(real, ran and (bool(real) or not names)); return None
    real = [n for n in real if already is not None and n not in already]
    print(("caught  " if real else "MISSED  ") + name + " -> " + (real[0][:90] if real else names[0][:90] + " (which fails with no fault in it too)" if names else "nothing failed") + (f" (+{len(real) - 1})" if len(real) > 1 else ""), flush=True)
    return bool(real)
faults, check = (PAGE, "sup_check.py") if which == "page" else (IMP, "importer_check.py")
if words: faults = [x for x in faults if any(w in x[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
caught, missed, broken = [], [], []
for name, f, a, b in ([(None, None, None, None)] if faults else []) + faults:
    got = run(name, f, a, b, [sys.executable, "-I", os.path.join(tests, check), "@APP", os.path.join(scratch, "mut-shots")])
    if name is not None: (broken if got is None else caught if got else missed).append(name)
print(json.dumps({"mode": which, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}))
