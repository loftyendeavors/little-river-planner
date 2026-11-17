"""Deliberate faults for the files the merge writes (tests/shared_test.cjs: tools/shared.cjs, tools/take_main.cjs, the counts'
join in tests/counts.py) and for the hooks (tests/hooks_test.cjs): each is put into a copy of the repository, and a named line
of the check must then fail where it passed before.
usage: python3 -I mutate_shared.py <the repository> <scratch> <fontsource dir> [node | list] [words…]     env FROM=, TO= to run a part
"""
import json, os, shutil, subprocess, sys
repo, scratch, fonts = [os.path.abspath(x) for x in sys.argv[1:4]]
mode = sys.argv[4] if len(sys.argv) > 4 else 'node'; words = [w.lower() for w in sys.argv[5:]]
SH, TM, CP, CH, CSS = 'tools/shared.cjs', 'tools/take_main.cjs', 'tests/counts.py', 'js/changes.js', 'css/app.css'
S, H = 'shared', 'hooks'

# (what the fault is, which check, the file, the text as it is, the text as the fault has it, words of the line that must fail)
FAULTS = [
  ('the label is not raised for a build that serves something new', S, SH, '  label = next(was.label);\n', '  label = was.label;\n', 'takes the next label'),
  ('the build\'s entry goes to the foot of the list', S, SH, 'builds = [{ label, on, did: entry.did, steps: entry.steps }, ...was.builds];', 'builds = [...was.builds, { label, on, did: entry.did, steps: entry.steps }];', 'takes the next label'),
  ('the builds before are dropped from the list', S, SH, 'builds = [{ label, on, did: entry.did, steps: entry.steps }, ...was.builds];', 'builds = [{ label, on, did: entry.did, steps: entry.steps }];', 'takes the next label'),
  ('the day is not today\'s', S, SH, "process.env.LRF_TODAY : new Intl", "'2001-01-01' : '2001-01-01' || new Intl", 'takes the next label'),
  ('the day the label was given is not kept on a later day', S, SH, '? kept.on : today;', '? today : today;', 'run again on a later day'),
  ('a build that serves something new is let through with no entry', S, SH, '  if (!entry) stop(', '  if (false) stop(', 'has no entry is stopped'),
  ('a build may have two files of its own', S, SH, 'if (mine.length > 1) stop(', 'if (mine.length > 9) stop(', 'two files of its own'),
  ('an entry is let through for a build that serves nothing new', S, SH, '} else if (entry) {\n  stop(', '} else if (false) {\n  stop(', 'serves nothing new is stopped'),
  ('sw.js is not written again once the list is', S, SH, "build(label);   // again", "// build(label);   // again", 'offline copy is written again'),
  ('the label is read from the build the branch left, not from main', S, TM, "const base = [git('merge-base', head, 'origin/main'), git('merge-base', take, 'origin/main')].reduce(", "const base = [was].reduce(", 'the next label after A'),
  ('the written files are left in conflict when main is taken in', S, TM, "for (const f of conflicted().filter(f => WRITTEN.includes(f))) { git('checkout', '--theirs', '--', f); git('add', '--', f); }", '', 'takes main in by itself'),
  ('the merge is not committed with --commit', S, TM, "if (flag('--commit')) {", 'if (false) {', 'takes main in by itself'),
  ('the counts are taken from main alone', S, TM, "side(head, 'here.json')", "side(take, 'here.json')", 'joined check by check'),
  ('a check both sides changed takes main\'s count', S, CP, 'else: v = (a or 0) + (b - (a or 0)) + (c - (a or 0));', 'else: v = c;', 'joined check by check'),
  ('on a branch that already holds main, --commit commits nothing', S, TM, "if (dirty && flag('--commit')) {", 'if (false) {', 'already holds main'),
  ('--abort leaves the merge open', S, TM, "if (flag('--abort')) { tryGit('merge', '--abort'); say(", "if (flag('--abort')) { say(", 'a real conflict is named'),
  ('a file in real conflict is taken from main without a word', S, TM, "for (const f of conflicted().filter(f => WRITTEN.includes(f))) {", "for (const f of conflicted()) {", 'a real conflict is named'),
  ('a hook a check reads is no longer written', H, CH, "h('span.wc-new', { dataset: { hook: 'changes-new' } }, 'New')", "h('span.wc-new', 'New')", 'every hook a check reads'),
  ('the style sheet styles a thing by its hook', H, CSS, '.dialog.wc {', '[data-hook="changes-new"] { color: inherit; }\n.dialog.wc {', 'no style sheet rule reads a hook'),
  ('a script of the planner finds a thing by its hook', H, CH, "  const $ = id => document.getElementById(id);\n", "  const $ = id => document.getElementById(id);\n  const fresh = () => document.querySelector('[data-hook=\"changes-new\"]');\n", 'no script of the planner finds'),
]
if mode == 'list': print(json.dumps({'node': len(FAULTS)})); sys.exit(0)

def copy():
    work = os.path.join(scratch, 'shared-copy')
    if os.path.exists(work): shutil.rmtree(work)
    shutil.copytree(repo, work, symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
    return work
def failed_lines(out):
    try: d = json.loads(out.strip().splitlines()[-1])
    except Exception: return None
    return [x if isinstance(x, str) else x.get('name', '') for x in d.get('failed') or []]
def run(work, which):
    cmd = ['node', os.path.join(work, 'tests', 'shared_test.cjs'), work, fonts] if which == S else ['node', os.path.join(work, 'tests', 'hooks_test.cjs'), work]
    try: out = subprocess.run(cmd, capture_output=True, text=True, timeout=300).stdout
    except subprocess.TimeoutExpired: out = ''
    return failed_lines(out)

faults = [f for f in FAULTS if not words or any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get('FROM', '0')):int(os.environ.get('TO', '999'))]
caught, missed, broken, already = [], [], [], {}
for which in sorted({f[1] for f in faults}):
    names = run(copy(), which)
    if names is None: print('with no fault in it %s gives no report: nothing can be shown to be caught' % which, flush=True)
    else:
        already[which] = set(names)
        if names: print('with no fault in it %s already fails, so these lines catch nothing: %s' % (which, '; '.join(names)[:700]), flush=True)
for n, (what, which, file, now, fault, line) in enumerate(faults):
    work = copy(); path = os.path.join(work, file); src = open(path, encoding='utf-8').read()
    if src.count(now) != 1:
        broken.append(what); print('BROKEN %d: %s -> the text to change is there %d times' % (n, what, src.count(now)), flush=True); continue
    open(path, 'w', encoding='utf-8').write(src.replace(now, fault))
    names = run(work, which) or []
    hit = [x for x in names if line.lower() in x.lower() and which in already and x not in already[which]]
    (caught if hit else missed).append(what)
    print(('caught ' if hit else 'MISSED ') + '%d: %s -> ' % (n, what) + (hit[0][:140] if hit else 'failed lines: %s' % names[:4]), flush=True)
shutil.rmtree(os.path.join(scratch, 'shared-copy'), ignore_errors=True)
print(json.dumps({'set': 'shared', 'mode': mode, 'faults': len(caught) + len(missed) + len(broken), 'caught': len(caught), 'missed': missed, 'broken': broken}, ensure_ascii=False))
sys.exit(0 if not missed and not broken else 1)
