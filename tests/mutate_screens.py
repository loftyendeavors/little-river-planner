"""Deliberate faults for tests/screens_check.py (a picture of each main screen, compared with the build before): each is put into
a copy of the built site or of what the build says of itself, and a named line of the check must fail.
usage: python3 -I mutate_screens.py <the repository> <scratch> <tests-dir> <the build before, as setup.sh unpacked it> <backup.zip> [page | list] [words…]     env FROM=, TO= to run a part
page: every fault against screens_check.py, each on the one screen and width it is about (about a minute each).
list: how many faults there are, and nothing else.
A fault in the look is a rule added at the end of the style sheet, so that no fault here depends on how a rule is written
today. Not a line of the check is changed. A fault is caught only by a line that passes before the fault is put in.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
repo, scratch, tests, oldroot = [Path(x).resolve() for x in sys.argv[1:5]]
backup = sys.argv[5]
mode = sys.argv[6] if len(sys.argv) > 6 else "page"; words = [w.lower() for w in sys.argv[7:]]
PAGE = ["index.html", "sw.js", "manifest.webmanifest", "css", "js", "fonts", "icons"]

def rule(text):
    def put(site, said):
        f = site / "css" / "app.css"; f.write_text(f.read_text(encoding="utf-8") + "\n" + text + "\n", encoding="utf-8")
    return put
def names(screen):
    def put(site, said): said["screens"] = sorted(set(said.get("screens") or []) | {screen})
    return put
def both(*changes):
    def put(site, said):
        for c in changes: c(site, said)
    return put

NARROW = ".view-assume .as-wrap { max-width: 1100px !important; }"
FAULTS = [
 # (name, what is done, the screen and width it is run on, words of the line that must fail)
 ("the Assumptions list is made narrower and the build does not say so", rule(NARROW), "assumptions-days", 1707, "assumptions-days at 1707 px looks as it did"),
 ("the small grey text is made darker everywhere and the build does not say so", rule(":root { --muted: #2f3a33 !important; }"), "timeline", 1707, "timeline at 1707 px looks as it did"),
 ("a line of Tasks is made taller on a phone and the build does not say so", rule("body.phone .tk-row { padding-block: 14px !important; }"), "tasks", 390, "tasks at 390 px looks as it did"),
 ("the build names a screen as changed that looks as it did", names("seeds"), "seeds", 1707, "seeds at 1707 px: the build names this screen as changed"),
 ("the build names a screen the check does not know", names("the-moon"), "seeds", 1707, "names only screens this check knows"),
]
if mode == "list": print(json.dumps({"page": len(FAULTS)})); sys.exit(0)

def run(change, screen, width):
    """The check on a copy, with one fault in it or none. Returns the names of the lines that failed, or None with why."""
    site, home = scratch / "screens-site", scratch / "screens-repo"
    for d in (site, home):
        if d.exists(): shutil.rmtree(d)
    site.mkdir(parents=True); (home / "tests" / "builds").mkdir(parents=True)
    for name in PAGE: (shutil.copytree if (repo / name).is_dir() else shutil.copy)(repo / name, site / name)
    was = {f.name for f in (oldroot / "tests" / "builds").glob("*.json")} if (oldroot / "tests" / "builds").is_dir() else set()
    own = [f for f in sorted((tests / "builds").glob("*.json")) if f.name not in was]
    said = json.loads(own[0].read_text(encoding="utf-8")) if own else {}
    if screen in (said.get("screens") or []): return None, f"the build itself names “{screen}” as changed: this fault needs a screen it does not name"
    if change: change(site, said)
    (home / "tests" / "builds" / (own[0].name if own else "this-build.json")).write_text(json.dumps(said), encoding="utf-8")
    env = {**os.environ, "ONLY": screen, "ONLY_WIDTH": str(width)}
    try: out = subprocess.run([sys.executable, "-I", str(tests / "screens_check.py"), str(site), str(oldroot), backup, str(scratch / "screens-shots"), str(home)], capture_output=True, text=True, timeout=600, env=env).stdout
    except subprocess.TimeoutExpired: return None, "the check did not end in ten minutes"
    try: d = json.loads(out[out.rfind('{"passed"'):])
    except Exception: return None, "the check gave no result: " + out[-200:].replace("\n", " ")
    return list(d["failed"]), ""

faults = FAULTS
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
caught, missed, broken = [], [], []
clean = {}   # with no fault in it, by screen and width
for name, change, screen, width, line in faults:
    if (screen, width) not in clean: clean[(screen, width)] = run(None, screen, width)
    before, why = clean[(screen, width)]
    if before is None: broken.append(name); print(f"BROKEN {name} :: with no fault in it, {why}", flush=True); continue
    if any(line in n for n in before): broken.append(name); print(f"BROKEN {name} :: the line that must fail fails with no fault in it: {[n for n in before if line in n][0][:120]}", flush=True); continue
    got, why = run(change, screen, width)
    if got is None: broken.append(name); print(f"BROKEN {name} :: {why}", flush=True); continue
    hit = [n for n in got if line in n]
    (caught if hit else missed).append(name)
    print(("caught " if hit else "MISSED ") + name + " :: " + (hit[0][:160] if hit else "failed lines: " + json.dumps(got[:3], ensure_ascii=False)), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}, ensure_ascii=False))
