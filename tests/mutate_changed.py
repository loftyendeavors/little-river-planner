"""Deliberate faults for tests/what_changed.cjs (what a build changed in what a browser is served, against the build before): each
is put into a copy of the served files, and a named line of the check must fail.
usage: python3 -I mutate_changed.py <the repository> <scratch> <tests-dir> <the build before, as setup.sh unpacked it> <dir holding node_modules/acorn> [node | list] [words…]     env FROM=, TO= to run a part
node: every fault against what_changed.cjs (under a second each). list: how many faults there are, and nothing else.
The check reads what the build says of itself in the this-build.json beside it, so it is a copy of the check that is run, beside
a copy of that file; for the fault that needs a script named under "words", the copy of the file names it. Not a line of the
check is changed. A fault is caught only by a line that passes before the fault is put in.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
repo, scratch, tests, oldroot, mods = [Path(x).resolve() for x in sys.argv[1:6]]
now, old = repo / "js", oldroot / "js"
PAGE = ["index.html", "sw.js", "manifest.webmanifest", "css", "fonts", "icons"]
mode = sys.argv[6] if len(sys.argv) > 6 else "node"; words = [w.lower() for w in sys.argv[7:]]

# what each fault does to the copy: js is the copy of the scripts, said is what the build says of itself, free is a script
# that the build does not name and that is the build before's, byte for byte
def space(js, said, free): (js / free).write_text((js / free).read_text(encoding="utf-8") + " ", encoding="utf-8")
def code(js, said, free): said["words"] = list(said.get("words") or []) + [free]; (js / free).write_text((js / free).read_text(encoding="utf-8") + "\n;void 0;\n", encoding="utf-8")
def added(js, said, free): (js / "one-more.js").write_text("// one script more\n", encoding="utf-8")
def gone(js, said, free): (js / free).unlink()
def unread(js, said, free): said.clear(); said["unreadable"] = True
def styles(js, said, free): f = js.parent / "css" / "app.css"; f.write_text(f.read_text(encoding="utf-8") + "\n/* one rule more */\n", encoding="utf-8")
def page(js, said, free): f = js.parent / "index.html"; f.write_text(f.read_text(encoding="utf-8") + "\n<!-- one line more -->\n", encoding="utf-8")
def other(js, said, free): said["base"] = "0000000"

FAULTS = [
 # (name, what is done, words of the line that must fail)
 ("a script the build does not name is changed, by one space", space, "byte for byte"),
 ("a script named under “words” has its code changed: a statement more", code, "only the text inside its strings differs"),
 ("a script is added that the build does not name", added, "no script is added"),
 ("a script is gone that the build does not name", gone, "no script is gone"),
 ("what the build says of itself cannot be read", unread, "this-build.json can be read"),
 ("the style sheet is changed and the build does not name it", styles, "every other file a browser is served"),
 ("the page is changed and the build does not name it", page, "every other file a browser is served"),
 ("what the build says of itself was written for another build", other, "was written for this build"),
]
if mode == "list": print(json.dumps({"node": len(FAULTS)})); sys.exit(0)

def run(change=None):
    """The check on a copy, with one fault in it or none. Returns the names of the lines that failed, or None with why."""
    work = scratch / "changed"
    if work.exists(): shutil.rmtree(work)
    (work / "tests").mkdir(parents=True); shutil.copytree(now, work / "js"); shutil.copy(tests / "what_changed.cjs", work / "tests")
    for name in PAGE: (shutil.copytree if (repo / name).is_dir() else shutil.copy)(repo / name, work / name)
    said = json.loads((tests / "this-build.json").read_text(encoding="utf-8"))
    named = {f for key in ("words", "code", "added", "removed") for f in (said.get(key) or [])}
    same = lambda f: (old / f).is_file() and (old / f).read_bytes() == (now / f).read_bytes()
    free = next((f.name for f in sorted(now.glob("*.js")) if f.name not in named and same(f.name)), None)
    if change:
        if not free: return None, "every script is named by the build or differs from the build before: there is none to put the fault in"
        change(work / "js", said, free)
    (work / "tests" / "this-build.json").write_text("not a record" if said.get("unreadable") else json.dumps(said), encoding="utf-8")
    out = subprocess.run(["node", str(work / "tests" / "what_changed.cjs"), str(work), str(oldroot), str(mods)], capture_output=True, text=True, timeout=120).stdout
    try: d = json.loads(out[out.rfind('{"passed"'):])
    except Exception: return None, "the check gave no result: " + out[-200:].replace("\n", " ")
    return [x["name"] if isinstance(x, dict) else x for x in d["failed"]], ("" if d.get("finished") else "the check did not run to its end")

faults = FAULTS
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
before, why = run()
caught, missed, broken = [], [], []
for name, change, line in faults:
    if before is None: broken.append(name); print(f"BROKEN {name} :: with no fault in it, {why}", flush=True); continue
    if any(line in n for n in before): broken.append(name); print(f"BROKEN {name} :: the line that must fail fails with no fault in it: {[n for n in before if line in n][0][:120]}", flush=True); continue
    names, why = run(change)
    if names is None: broken.append(name); print(f"BROKEN {name} :: {why}", flush=True); continue
    hit = [n for n in names if line in n]
    (caught if hit else missed).append(name)
    print(("caught " if hit else "MISSED ") + name + " :: " + (hit[0][:160] if hit else "failed lines: " + json.dumps(names[:3], ensure_ascii=False)), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}, ensure_ascii=False))
